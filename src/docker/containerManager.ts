/**
 * High-Performance Docker Container Manager
 * 
 * Implements container pooling for near-instant Claude Code execution
 * with proper authentication injection and resource management.
 */

import Docker from 'dockerode';
import { ClaudeAuthManager, type AuthTokens } from '../auth/claudeAuthManager.js';
import { existsSync, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitContainerDiffManager } from '../tools/git-container-diff-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Debug logging function
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';
function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error('[Docker]', message, ...optionalParams);
  }
}

export interface ContainerConfig {
  memory?: string;
  cpus?: string;
  timeout?: number;
  networkIsolation?: boolean;
}

export interface Container {
  id: string;
  name: string;
  status: 'creating' | 'ready' | 'in-use' | 'cleanup' | 'error';
  created: Date;
  lastUsed?: Date;
  authConfigured: boolean;
  workspaceConfigured: boolean;
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number;
  containerId: string;
}

interface ContainerPool {
  warm: Container[];           // Ready containers with auth configured
  inUse: Map<string, Container>; // Active containers
}

export class ContainerManager {
  private docker: Docker;
  private authManager: ClaudeAuthManager;
  private gitDiffManager: GitContainerDiffManager;
  private pool: ContainerPool;
  private readonly imageName = 'claude-execution-anthropic:latest';
  private readonly defaultPoolSize = 3;
  private readonly maxPoolSize = 10;
  private poolInitialized = false;
  private backgroundTasks: Set<Promise<void>> = new Set();

  constructor() {
    // Configure Docker connection - detect if using Colima or other custom setup
    const dockerHost = process.env.DOCKER_HOST;
    
    if (dockerHost && dockerHost.startsWith('unix://')) {
      // Use Unix socket from DOCKER_HOST
      const socketPath = dockerHost.replace('unix://', '');
      debugLog(`Using Docker socket from DOCKER_HOST: ${socketPath}`);
      this.docker = new Docker({ socketPath });
    } else if (dockerHost) {
      // Non-unix socket (TCP, etc)
      debugLog(`Using Docker host: ${dockerHost}`);
      this.docker = new Docker({ host: dockerHost });
    } else if (process.env.HOME && existsSync(`${process.env.HOME}/.colima/default/docker.sock`)) {
      // Fallback to Colima socket if it exists
      const socketPath = `${process.env.HOME}/.colima/default/docker.sock`;
      debugLog(`Using Colima Docker socket: ${socketPath}`);
      this.docker = new Docker({ socketPath });
    } else {
      // Use default Docker connection
      debugLog('Using default Docker connection');
      this.docker = new Docker();
    }
    
    this.authManager = new ClaudeAuthManager();
    this.gitDiffManager = new GitContainerDiffManager(this.docker);
    this.pool = {
      warm: [],
      inUse: new Map()
    };
  }

  /**
   * Initialize the container management system
   */
  async initialize(): Promise<void> {
    try {
      // Test Docker connection
      await this.docker.ping();
      debugLog('Docker connection established');

      // Build or pull the execution image
      await this.ensureExecutionImage();

      // Initialize container pool
      await this.initializeContainerPool();

      this.poolInitialized = true;
      debugLog('Container manager initialized successfully');

    } catch (error) {
      console.error('Failed to initialize container manager:', error);
      throw error;
    }
  }

  /**
   * Ensure the execution image exists, build if necessary
   */
  private async ensureExecutionImage(): Promise<void> {
    try {
      // Check if image exists
      const images = await this.docker.listImages();
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.includes(this.imageName)
      );

      if (imageExists) {
        debugLog(`Image ${this.imageName} already exists`);
        return;
      }

      console.log(`🔨 Building Docker image ${this.imageName}...`);
      const dockerfilePath = path.resolve('docker/claude-execution');
      
      if (!existsSync(path.join(dockerfilePath, 'Dockerfile'))) {
        throw new Error(`Dockerfile not found at ${dockerfilePath}/Dockerfile`);
      }

      // Build the image
      const stream = await this.docker.buildImage({
        context: dockerfilePath,
        src: ['Dockerfile']
      }, {
        t: this.imageName,
        pull: true, // Pull base image updates
        nocache: false
      });

      // Wait for build to complete
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        }, (event) => {
          if (event.stream) {
            debugLog('Build:', event.stream.trim());
          }
        });
      });

      console.log(`✅ Successfully built ${this.imageName}`);

    } catch (error) {
      console.error('Failed to ensure execution image:', error);
      throw error;
    }
  }

  /**
   * Initialize the container pool with warm containers
   */
  private async initializeContainerPool(): Promise<void> {
    debugLog(`Initializing container pool with ${this.defaultPoolSize} containers...`);

    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < this.defaultPoolSize; i++) {
      promises.push(this.createWarmContainer().then(container => {
        if (container) {
          this.pool.warm.push(container);
          debugLog(`Added container ${container.id} to warm pool`);
        }
      }));
    }

    await Promise.all(promises);
    debugLog(`Container pool initialized with ${this.pool.warm.length} warm containers`);
  }

  /**
   * Create a warm container ready for immediate use
   */
  private async createWarmContainer(taskId?: string): Promise<Container | null> {
    try {
      // Use task ID if provided, otherwise use timestamp-random pattern
      const containerName = taskId 
        ? `claude-parallel-${taskId}`
        : `claude-parallel-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      const createOptions = {
        Image: this.imageName,
        name: containerName,
        Labels: {
          'claude-parallel': 'true',
          'pool-managed': 'true',
          ...(taskId ? { 'task-id': taskId } : {}),
        },
        Env: [],
        HostConfig: {
          Memory: 2 * 1024 * 1024 * 1024, // 2GB default
          CpuQuota: 200000, // 2 CPUs
          CpuPeriod: 100000,
          RestartPolicy: { Name: 'no' }, // Don't auto-restart
          NetworkMode: 'default', // Network access with firewall restrictions
          ReadonlyRootfs: false, // Allow writes to workspace
          SecurityOpt: ['apparmor:unconfined'], // Required for iptables in container
          CapAdd: ['NET_ADMIN'], // Required for firewall configuration
        },
        WorkingDir: '/workspace',
        User: 'node',
      };

      const dockerContainer = await this.docker.createContainer(createOptions);
      await dockerContainer.start();

      // Configure authentication in background
      const container: Container = {
        id: dockerContainer.id,
        name: containerName,
        status: 'creating',
        created: new Date(),
        authConfigured: false,
        workspaceConfigured: false
      };

      // Configure container (auth + firewall) in background (don't block pool initialization)
      this.configureContainer(container).catch(error => {
        debugLog(`Failed to configure container ${container.id}:`, error);
        container.status = 'error';
      });

      return container;

    } catch (error) {
      debugLog('Failed to create warm container:', error);
      return null;
    }
  }

  /**
   * Configure container (authentication and firewall)
   */
  private async configureContainer(container: Container): Promise<void> {
    try {
      const dockerContainer = this.docker.getContainer(container.id);

      // Step 1: Set up firewall for secure network access
      debugLog(`Setting up firewall for container ${container.id}...`);
      const firewallExec = await dockerContainer.exec({
        Cmd: ['sudo', '/usr/local/bin/init-firewall.sh'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'node'
      });
      const firewallStream = await firewallExec.start({});
      debugLog(`Firewall configured for container ${container.id}`);

      // Step 2: Configure authentication
      const tokens = await this.authManager.readClaudeAuthToken();
      
      if (!tokens) {
        throw new Error('No authentication tokens available');
      }

      // Simply copy auth to container - Claude CLI will use it automatically
      if (tokens.isApiKey) {
        // Set API key as environment variable
        const exec = await dockerContainer.exec({
          Cmd: ['bash', '-c', `echo 'export ANTHROPIC_API_KEY="${tokens.accessToken}"' >> /home/node/.bashrc`],
          AttachStdout: true,
          AttachStderr: true,
          User: 'node'
        });
        await exec.start({});
        debugLog(`Set API key for container ${container.id}`);
      } else {
        // Copy auth tokens to the exact location where Claude CLI stores them
        const claudeConfig = {
          claudeAiOauth: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes
          }
        };
        
        const configContent = JSON.stringify(claudeConfig, null, 2);
        
        // Store in the locations that Claude CLI actually uses (confirmed via testing)
        const exec = await dockerContainer.exec({
          Cmd: ['bash', '-c', `
            mkdir -p /home/node/.config/Claude
            mkdir -p /home/node/.claude
            echo '${configContent}' > /home/node/.config/Claude/credentials.json
            echo '${configContent}' > /home/node/.claude/.credentials.json
            chmod 600 /home/node/.config/Claude/credentials.json
            chmod 600 /home/node/.claude/.credentials.json
          `],
          AttachStdout: true,
          AttachStderr: true,
          User: 'node'
        });
        await exec.start({});
        debugLog(`Copied auth config to Claude CLI locations for container ${container.id}`);
      }

      container.authConfigured = true;
      container.status = 'ready';
      debugLog(`Configured authentication for container ${container.id} (${tokens.source})`);

    } catch (error) {
      debugLog(`Failed to configure auth for container ${container.id}:`, error);
      container.status = 'error';
      throw error;
    }
  }

  /**
   * Create a container with isolated workspace for git tracking
   */
  async createReadOnlyContainer(
    workspacePath: string,
    config?: ContainerConfig,
    taskId?: string
  ): Promise<Container> {
    await this.ensureExecutionImage();
    
    const containerName = taskId ? 
      `claude-parallel-${taskId}` : 
      `claude-exec-${Date.now()}`;

    debugLog(`Creating isolated container ${containerName} for ${workspacePath}`);

    try {
      // Create container without bind mounts - we'll copy files instead
      const container = await this.docker.createContainer({
        Image: this.imageName,
        name: containerName,
        Hostname: 'claude-secure',
        WorkingDir: '/workspace',
        User: 'node',
        Env: [
          'NODE_ENV=production',
          `CLAUDE_WORKSPACE=${workspacePath}`,
          'HOME=/home/node'
        ],
        HostConfig: {
          // No bind mounts - files will be copied to ensure clean git tracking
          Memory: config?.memory ? parseInt(config.memory) * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024,
          CpuQuota: config?.cpus ? parseInt(config.cpus) * 100000 : 200000,
          CpuPeriod: 100000,
          AutoRemove: false, // Don't auto-remove, we'll manage lifecycle
          ReadonlyRootfs: false, // Allow writes to container layer
          SecurityOpt: ['apparmor:unconfined'], // Required for some operations
          CapAdd: ['NET_ADMIN', 'CHOWN', 'SETUID', 'SETGID'], // Required permissions
          NetworkMode: 'default', // Network access with firewall restrictions
        },
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Tty: false,
        OpenStdin: false,
        Labels: {
          'claude-parallel': 'true',
          'task-id': taskId || 'unknown',
          'workspace': workspacePath
        }
      });

      // Start the container
      await container.start();
      
      // Configure authentication
      await this.configureContainerAuth(container);
      
      // Create workspace directory
      debugLog(`Creating workspace directory in container ${containerName}...`);
      const mkdirExec = await container.exec({
        Cmd: ['bash', '-c', 'mkdir -p /workspace && chown -R node:node /workspace'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root'
      });
      await mkdirExec.start({});
      
      // Copy files from host to container (excluding .git)
      debugLog(`Copying files from ${workspacePath} to container ${containerName}...`);
      await this.copyToContainer(container.id, workspacePath, '/', 'workspace');
      
      // Fix file ownership after copying (critical for git tracking)
      debugLog(`Fixing file ownership in container ${containerName}...`);
      const chownExec = await container.exec({
        Cmd: ['chown', '-R', 'node:node', '/workspace'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root'
      });
      await chownExec.start({});
      
      // Initialize Git tracking AFTER files are copied and ownership is fixed
      debugLog(`Initializing Git tracking in container ${containerName}...`);
      await this.gitDiffManager.initializeGitTracking(container);
      
      // Return the Docker container directly
      return container as any;
    } catch (error) {
      debugLog(`Failed to create isolated container:`, error);
      throw error;
    }
  }

  /**
   * Configure authentication for a Docker container
   */
  private async configureContainerAuth(container: Docker.Container): Promise<void> {
    try {
      const tokens = await this.authManager.readClaudeAuthToken();
      
      if (!tokens) {
        throw new Error('No authentication tokens available');
      }
      
      debugLog(`Configuring auth for container - token type: ${tokens.isApiKey ? 'API Key' : 'OAuth'}, source: ${tokens.source}`);

      // Configure authentication based on token type
      if (tokens.isApiKey) {
        // Set API key as environment variable
        const exec = await container.exec({
          Cmd: ['bash', '-c', `echo 'export ANTHROPIC_API_KEY="${tokens.accessToken}"' >> /home/node/.bashrc`],
          AttachStdout: true,
          AttachStderr: true,
          User: 'node'
        });
        await exec.start({});
        debugLog(`Set API key for container ${container.id}`);
      } else {
        // Copy OAuth tokens to Claude CLI locations
        const claudeConfig = {
          claudeAiOauth: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes
          }
        };
        
        const configContent = JSON.stringify(claudeConfig, null, 2);
        // Escape the JSON for safe shell usage
        const escapedConfig = configContent.replace(/'/g, "'\"'\"'").replace(/\$/g, '\\$');
        
        // Store in the locations that Claude CLI uses
        const exec = await container.exec({
          Cmd: ['bash', '-c', `
            mkdir -p /home/node/.config/Claude
            mkdir -p /home/node/.claude
            cat > /home/node/.config/Claude/credentials.json << 'EOFCONFIG'
${configContent}
EOFCONFIG
            cp /home/node/.config/Claude/credentials.json /home/node/.claude/.credentials.json
            chmod 600 /home/node/.config/Claude/credentials.json
            chmod 600 /home/node/.claude/.credentials.json
            # Verify the files were created
            ls -la /home/node/.claude/.credentials.json
            echo "Auth configured successfully"
          `],
          AttachStdout: true,
          AttachStderr: true,
          User: 'node'
        });
        
        const stream = await exec.start({ hijack: true });
        
        // Capture output to verify success
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        
        await new Promise((resolve, reject) => {
          stream.on('end', resolve);
          stream.on('error', reject);
        });
        
        debugLog(`Configured OAuth for container ${container.id}:`, output);
      }
    } catch (error) {
      console.error(`[ContainerManager] Failed to configure container auth:`, error);
      debugLog(`Failed to configure container auth:`, error);
      throw error;
    }
  }

  /**
   * Get a ready container from the pool (fast path)
   */
  async getExecutionContainer(workspacePath: string, config: ContainerConfig = {}, taskId?: string, forceNew = false): Promise<Container> {
    if (!this.poolInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // For background tasks or when forced, always create new container with task ID name
    // For sync tasks, try to get a warm container first
    let container = forceNew ? null : this.getWarmContainer();

    if (!container) {
      // Fallback: create new container (slower path)
      debugLog('No warm containers available, creating new one...');
      container = await this.createWarmContainer(taskId);
      
      if (!container) {
        throw new Error('Failed to create execution container');
      }
    } else if (taskId) {
      // Add task ID as a label to the warm container for easy identification
      try {
        const dockerContainer = this.docker.getContainer(container.id);
        const containerInfo = await dockerContainer.inspect();
        await dockerContainer.update({
          Labels: {
            ...containerInfo.Config.Labels,
            'task-id': taskId
          }
        });
        debugLog(`Added task ID label ${taskId} to container ${container.id}`);
      } catch (error) {
        debugLog(`Warning: Could not add task ID label to container: ${error}`);
      }
    }

    // Wait for auth configuration with timeout (only for new containers)
    if (!container.authConfigured) {
      const authTimeout = 5000; // 5 seconds max
      const authStartTime = Date.now();
      
      while (!container.authConfigured && container.status !== 'error') {
        if (Date.now() - authStartTime > authTimeout) {
          container.status = 'error';
          throw new Error(`Container auth configuration timed out after ${authTimeout}ms`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (container.status === 'error') {
        throw new Error('Failed to configure container authentication');
      }
    }

    // Move container to in-use pool
    container.status = 'in-use';
    container.lastUsed = new Date();
    this.pool.inUse.set(container.id, container);

    // Configure workspace (fast operation)
    await this.configureContainerWorkspace(container, workspacePath);

    // Replenish pool in background
    this.replenishPoolInBackground();

    const totalTime = Date.now() - startTime;
    debugLog(`Got execution container ${container.id} in ${totalTime}ms`);

    return container;
  }

  /**
   * Get a warm container from the pool
   */
  private getWarmContainer(): Container | null {
    // Find a ready container
    const containerIndex = this.pool.warm.findIndex(c => 
      c.status === 'ready' && c.authConfigured
    );

    if (containerIndex >= 0) {
      const container = this.pool.warm.splice(containerIndex, 1)[0];
      debugLog(`Using warm container ${container.id}`);
      return container;
    }

    return null;
  }

  /**
   * Configure workspace in container by copying project files
   */
  private async configureContainerWorkspace(container: Container, workspacePath: string): Promise<void> {
    try {
      if (!existsSync(workspacePath)) {
        throw new Error(`Workspace path does not exist: ${workspacePath}`);
      }

      const dockerContainer = this.docker.getContainer(container.id);

      // Create workspace directory in container
      debugLog(`Creating workspace directory in container ${container.id}...`);
      const mkdirExec = await dockerContainer.exec({
        Cmd: ['bash', '-c', 'mkdir -p /workspace && chown -R node:node /workspace'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root' // Need root to create directories and set ownership
      });
      await mkdirExec.start({});

      // Copy files from host to container
      debugLog(`Copying files from ${workspacePath} to container ${container.id}...`);
      await this.copyToContainer(container.id, workspacePath, '/', 'workspace-source');

      // Use rsync for fast file copying (excluding common ignore patterns)
      debugLog(`Syncing files in container ${container.id}...`);
      const exec = await dockerContainer.exec({
        Cmd: [
          'bash', '-c',
          `rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.DS_Store' --exclude='*.log' /workspace-source/ /workspace/ && ls -la /workspace`
        ],
        AttachStdout: true,
        AttachStderr: true,
        User: 'node'
      });
      
      // Execute the rsync command and capture output
      const stream = await exec.start({});
      
      let output = '';
      let error = '';
      
      stream.on('data', (chunk: any) => {
        const data = chunk.toString();
        if (chunk[0] === 1) { // stdout
          output += data.slice(8);
        } else if (chunk[0] === 2) { // stderr
          error += data.slice(8);
        }
      });
      
      // Wait for completion
      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      debugLog(`Rsync output: ${output}`);
      if (error) {
        debugLog(`Rsync error: ${error}`);
      }

      // Fix file ownership after rsync (critical for git tracking)
      debugLog(`Fixing file ownership after rsync in container ${container.id}...`);
      const chownExec = await dockerContainer.exec({
        Cmd: ['chown', '-R', 'node:node', '/workspace'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root'
      });
      await chownExec.start({});

      container.workspaceConfigured = true;
      debugLog(`Configured workspace for container ${container.id}`);

    } catch (error) {
      debugLog(`Failed to configure workspace for container ${container.id}:`, error);
      throw error;
    }
  }

  /**
   * Copy files from host to container using tar
   */
  private async copyToContainer(containerId: string, sourcePath: string, extractPath: string, targetFolder: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    
    try {
      debugLog(`Starting file copy: ${sourcePath} -> ${extractPath}/${targetFolder}`);
      
      // Use Docker's putArchive to copy files
      const tar = await import('tar-stream');
      const fs = await import('fs');
      const path = await import('path');
      
      const tarPack = tar.pack();
      let fileCount = 0;
      
      // Add all files from sourcePath to tar with targetFolder prefix
      const addToTar = async (dirPath: string, basePath: string = '') => {
        try {
          const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
          
          for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            // Prefix with targetFolder so files extract to the right location
            const relativePath = path.join(targetFolder, basePath, item.name).replace(/\\/g, '/'); // Normalize path separators
            
            // Skip common ignore patterns
            if (item.name.match(/^(\.git|node_modules|dist|\.DS_Store|.*\.log|__pycache__|\.pytest_cache)$/)) {
              continue;
            }
            
            if (item.isDirectory()) {
              // Add directory entry
              tarPack.entry({ 
                name: relativePath + '/',
                type: 'directory',
                mode: 0o755
              });
              await addToTar(fullPath, path.join(basePath, item.name));
            } else if (item.isFile()) {
              try {
                const content = await fs.promises.readFile(fullPath);
                const stat = await fs.promises.stat(fullPath);
                tarPack.entry({ 
                  name: relativePath,
                  size: stat.size,
                  mode: stat.mode & 0o777 // Preserve file permissions
                }, content);
                fileCount++;
              } catch (fileError) {
                debugLog(`Warning: Could not read file ${fullPath}: ${fileError}`);
                // Continue with other files
              }
            }
          }
        } catch (dirError) {
          debugLog(`Warning: Could not read directory ${dirPath}: ${dirError}`);
          // Continue with parent directory processing
        }
      };
      
      await addToTar(sourcePath);
      tarPack.finalize();
      
      debugLog(`Prepared tar archive with ${fileCount} files`);
      
      // Copy to container - Docker will extract the tar to the extract path
      await container.putArchive(tarPack, { path: extractPath });
      
      debugLog(`Successfully copied ${fileCount} files to container ${containerId} at ${extractPath}/${targetFolder}`);
      
    } catch (error) {
      debugLog(`Failed to copy files to container: ${error}`);
      throw new Error(`File copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute Claude Code in a container
   */
  async executeClaudeCode(container: Container, prompt: string, options: any = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const dockerContainer = this.docker.getContainer(container.id);
      
      // Build Claude Code command
      const claudeCommand = this.buildClaudeCommand(prompt, options);
      
      // Create log file for this execution
      const taskId = options.taskId || `container-${container.id.substring(0, 12)}`;
      const logFileName = `${taskId}-${Date.now()}.log`;
      // Use __dirname to get the directory of this file, then navigate to logs
      const logsDir = path.join(__dirname, '..', 'logs');
      const logPath = path.join(logsDir, logFileName);
      
      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });
      
      // Create write stream for logging
      const logStream = createWriteStream(logPath, { flags: 'a' });
      
      // Write header
      logStream.write(`=== Claude Code Execution Log ===\n`);
      logStream.write(`Task ID: ${taskId}\n`);
      logStream.write(`Container: ${container.id}\n`);
      logStream.write(`Started: ${new Date().toISOString()}\n`);
      logStream.write(`Command: ${claudeCommand}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);
      
      const exec = await dockerContainer.exec({
        Cmd: ['bash', '-c', claudeCommand],
        AttachStdout: true,
        AttachStderr: true,
        User: 'node',
        WorkingDir: '/workspace'
      });

      const stream = await exec.start({});
      let output = '';
      let error = '';

      // Collect output and stream to log file
      stream.on('data', (chunk: any) => {
        const data = chunk.toString();
        const timestamp = new Date().toISOString();
        
        if (chunk[0] === 1) { // stdout
          const content = data.slice(8); // Remove Docker stream header
          output += content;
          logStream.write(`[${timestamp}] [STDOUT] ${content}`);
        } else if (chunk[0] === 2) { // stderr
          const content = data.slice(8);
          error += content;
          logStream.write(`[${timestamp}] [STDERR] ${content}`);
        }
      });

      // Wait for completion
      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const executionTime = Date.now() - startTime;
      
      // Write footer
      logStream.write(`\n${'='.repeat(50)}\n`);
      logStream.write(`Completed: ${new Date().toISOString()}\n`);
      logStream.write(`Execution time: ${executionTime}ms\n`);
      logStream.write(`Success: true\n`);
      logStream.end();
      
      debugLog(`Execution logs saved to: ${logPath}`);
      
      return {
        success: true,
        output: output.trim(),
        error: error.trim() || undefined,
        executionTime,
        containerId: container.id
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        containerId: container.id
      };
    }
  }

  /**
   * Build Claude Code command with options
   */
  private buildClaudeCommand(prompt: string, options: any = {}): string {
    let command = 'claude';
    
    // Add common options
    if (options.outputFormat) {
      command += ` --output-format ${options.outputFormat}`;
    }
    
    if (options.maxTurns) {
      command += ` --max-turns ${options.maxTurns}`;
    }

    // Add the prompt (properly escaped)
    const escapedPrompt = prompt.replace(/'/g, "'\"'\"'"); // Shell escape
    command += ` -p '${escapedPrompt}'`;

    return command;
  }

  /**
   * Return container to pool or cleanup
   */
  async releaseContainer(container: Container, cleanup: boolean = false): Promise<void> {
    // Remove from in-use pool
    this.pool.inUse.delete(container.id);

    if (cleanup || this.pool.warm.length >= this.maxPoolSize) {
      // Cleanup container
      await this.cleanupContainer(container);
    } else {
      // Reset container for reuse
      await this.resetContainer(container);
      
      // Return to warm pool
      container.status = 'ready';
      container.workspaceConfigured = false;
      this.pool.warm.push(container);
      debugLog(`Returned container ${container.id} to warm pool`);
    }
  }

  /**
   * Reset container workspace for reuse
   */
  private async resetContainer(container: Container): Promise<void> {
    try {
      const dockerContainer = this.docker.getContainer(container.id);
      
      // Clean workspace
      const exec = await dockerContainer.exec({
        Cmd: ['bash', '-c', 'rm -rf /workspace/* /workspace/.*[!.] 2>/dev/null || true'],
        User: 'node'
      });
      await exec.start({});

      debugLog(`Reset container ${container.id} workspace`);
    } catch (error) {
      debugLog(`Failed to reset container ${container.id}:`, error);
      // If reset fails, mark for cleanup
      container.status = 'error';
    }
  }

  /**
   * Cleanup and destroy a container
   */
  private async cleanupContainer(container: Container): Promise<void> {
    try {
      const dockerContainer = this.docker.getContainer(container.id);
      
      try {
        await dockerContainer.stop({ t: 5 }); // 5 second timeout
      } catch (error) {
        // Container might already be stopped
      }
      
      await dockerContainer.remove();
      debugLog(`Cleaned up container ${container.id}`);
    } catch (error) {
      debugLog(`Failed to cleanup container ${container.id}:`, error);
    }
  }

  /**
   * Replenish pool in background
   */
  private replenishPoolInBackground(): void {
    if (this.pool.warm.length >= this.defaultPoolSize) {
      return; // Pool is full
    }

    const task = this.createWarmContainer().then(container => {
      if (container) {
        this.pool.warm.push(container);
        debugLog(`Background: Added container ${container.id} to warm pool`);
      }
    }).finally(() => {
      this.backgroundTasks.delete(task);
    });

    this.backgroundTasks.add(task);
  }

  /**
   * Get pool status
   */
  getPoolStatus(): {
    warm: number;
    inUse: number;
    backgroundTasks: number;
  } {
    return {
      warm: this.pool.warm.length,
      inUse: this.pool.inUse.size,
      backgroundTasks: this.backgroundTasks.size
    };
  }

  /**
   * Extract Git diff from a container
   */
  async extractGitDiff(container: Docker.Container): Promise<import('../types/git-diff-types.js').GitDiffExtractResult> {
    return this.gitDiffManager.extractDiff(container);
  }

  /**
   * Cleanup all containers and shutdown
   */
  async shutdown(): Promise<void> {
    debugLog('Shutting down container manager...');

    // Wait for background tasks
    await Promise.all(this.backgroundTasks);

    // Cleanup all containers
    const allContainers = [
      ...this.pool.warm,
      ...Array.from(this.pool.inUse.values())
    ];

    await Promise.all(allContainers.map(container => 
      this.cleanupContainer(container)
    ));

    debugLog('Container manager shut down complete');
  }
}
