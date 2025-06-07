#!/usr/bin/env node
/**
 * Claude Parallel Work Server with Secure Containerized Execution
 * 
 * MCP server that breaks down complex development work into parallel tasks
 * for dramatically faster project completion through intelligent orchestration.
 * 
 * Core features:
 * - AI-powered task breakdown and dependency analysis
 * - Parallel task execution in isolated containers
 * - Git-based change tracking and diff management
 * - Real-time monitoring and progress tracking
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, exec } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import * as path from 'path';
import * as os from 'os';
import retry from 'async-retry';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { logger, wrapToolHandler } from './utils/logger.js';

const execAsync = promisify(exec);

// Read package.json synchronously
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// Import secure execution components
import { GitIntegratedClaudeCodeManager, type GitIntegratedExecutionArgs, type ProgressCallback } from './tools/claude-code-git-integrated.js';
import { DiffManagementTools } from './tools/diffManagementTools.js';
import { ParallelTaskOrchestrationTools } from './tools/parallel-task-tools.js';
import { handleContainerLogsTools } from './tools/container-logs-tools.js';
import { TaskManagementTools } from './tools/task-management-tools.js';
import { InitTool } from './tools/init-tool.js';
import { 
  checkDashboardStatus, 
  launchDashboard, 
  getDashboardSetupInstructions,
  type DashboardStatus 
} from './dashboard-tools.js';
import { PersistenceManager } from './persistence/database.js';
import { StartupRecoveryManager } from './recovery/startup-recovery.js';
import { handleTasksValidationTools } from './tools/tasks-validation-tools.js';

// Define environment variables globally
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';
const heartbeatIntervalMs = 15000; // 15 seconds heartbeat interval
const maxRetries = parseInt(process.env.MCP_MAX_RETRIES || '3', 10);
const retryDelayMs = parseInt(process.env.MCP_RETRY_DELAY_MS || '1000', 10);

// Secure execution is always enabled - it's a core feature
const enableSecureExecution = true;


// Dedicated debug logging function
function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    process.stderr.write(`[Server] ${message}\n`);
  }
}

/**
 * Determine the Claude CLI command/path.
 */
function findClaudeCli(): string {
  debugLog('Attempting to find Claude CLI...');

  const userPath = join(homedir(), '.claude', 'local', 'claude');
  debugLog(`Checking for Claude CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`Found Claude CLI at local user path: ${userPath}`);
    return userPath;
  } else {
    debugLog(`Claude CLI not found at local user path: ${userPath}`);
  }

  debugLog('Falling back to "claude" command name, relying on spawn/PATH lookup.');
  console.warn('[Warning] Claude CLI not found at ~/.claude/local/claude. Falling back to "claude" in PATH.');
  return 'claude';
}



/**
 * Execute a command asynchronously with progress reporting
 */
async function spawnAsync(command: string, args: string[], options?: { timeout?: number, cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog(`Running command: ${command} ${args.join(' ')}`);
    const process = spawn(command, args, {
      shell: false,
      timeout: options?.timeout,
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let executionStartTime = Date.now();
    let heartbeatCounter = 0;

    const progressReporter = setInterval(() => {
      heartbeatCounter++;
      const elapsedSeconds = Math.floor((Date.now() - executionStartTime) / 1000);
      const heartbeatMessage = `[Progress] Claude Code execution in progress: ${elapsedSeconds}s elapsed (heartbeat #${heartbeatCounter})`;
      
      console.error(heartbeatMessage);
      debugLog(heartbeatMessage);
    }, heartbeatIntervalMs);

    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      debugLog(`Stderr chunk: ${data.toString()}`);
    });

    process.on('error', (error: NodeJS.ErrnoException) => {
      clearInterval(progressReporter);
      debugLog('Spawn error:', error);
      let errorMessage = `Spawn error: ${error.message}`;
      if (error.path) errorMessage += ` | Path: ${error.path}`;
      if (error.syscall) errorMessage += ` | Syscall: ${error.syscall}`;
      errorMessage += `\nStderr: ${stderr.trim()}`;
      reject(new Error(errorMessage));
    });

    process.on('close', (code) => {
      clearInterval(progressReporter);
      const executionTimeMs = Date.now() - executionStartTime;
      debugLog(`Exit code: ${code}, Execution time: ${executionTimeMs}ms`);
      
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}\nStderr: ${stderr.trim()}\nStdout: ${stdout.trim()}`));
      }
    });
  });
}

// Dashboard-specific types
interface Repository {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  taskCount: number;
  containerCount: number;
  diffCount: number;
  lastActivity: Date;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  repoId: string;
  startTime?: Date;
  endTime?: Date;
  progress?: number;
  containerId?: string;
  diffId?: string;
  parentTaskId?: string;
  metadata?: Record<string, any>;
}

interface Container {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'created' | 'exited';
  repoId: string;
  taskId?: string;
  image: string;
  startTime: Date;
  ports?: string[];
}

interface Diff {
  id: string;
  repoId: string;
  taskId?: string;
  status: 'pending' | 'applied' | 'rejected';
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: Date;
  summary?: string;
}

/**
 * Claude Parallel Work MCP Server with Secure Containerized Execution
 */
class ClaudeParallelWorkServer {
  private server: Server;
  private claudeCliPath: string;
  private packageVersion: string;
  private activeRequests: Set<string> = new Set();
  private streamingClients = new Set<SSEServerTransport>();
  
  // Secure execution components
  private secureManager: GitIntegratedClaudeCodeManager | null = null;
  private diffTools: DiffManagementTools | null = null;
  private taskOrchestration: ParallelTaskOrchestrationTools | null = null;
  private taskManagement: TaskManagementTools | null = null;
  
  // Dashboard data stores (initialized on demand)
  private dashboardEnabled = false;
  private repositories: Map<string, Repository> = new Map();
  private tasks: Map<string, Task> = new Map();
  private containers: Map<string, Container> = new Map();
  private diffs: Map<string, Diff> = new Map();
  
  // Persistence layer
  private persistence: PersistenceManager | null = null;

  constructor() {
    this.claudeCliPath = findClaudeCli();
    // Use stderr to avoid contaminating MCP protocol
    process.stderr.write(`[Setup] Using Claude CLI command/path: ${this.claudeCliPath}\n`);
    this.packageVersion = packageJson.version;

    this.server = new Server(
      {
        name: 'claude_parallel_work',
        version: this.packageVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize persistence layer
    try {
      this.persistence = new PersistenceManager();
      logger.info('Persistence layer initialized');
    } catch (error) {
      logger.error('Failed to initialize persistence - will continue without it', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.stderr.write('⚠️ Persistence disabled - server state will not survive restarts\n');
    }

    this.setupToolHandlers();
    this.setupShutdownHandlers();
    
    // Initialize task management (always available)
    this.taskManagement = new TaskManagementTools();
    
    // Initialize secure execution (core feature)
    this.initializeSecureExecution();

    this.server.onerror = (error) => process.stderr.write(`[Error] ${error}\n`);
  }

  /**
   * Initialize secure execution components
   */
  private async initializeSecureExecution(): Promise<void> {
    try {
      debugLog('Initializing secure execution components...');
      
      // Perform startup cleanup
      await this.performStartupCleanup();
      
      // Perform startup recovery if persistence is available
      if (this.persistence) {
        try {
          const docker = new (await import('dockerode')).default();
          const recoveryManager = new StartupRecoveryManager(docker, this.persistence);
          await recoveryManager.recoverOnStartup();
          logger.info('Startup recovery completed');
        } catch (error) {
          logger.error('Startup recovery failed', {
            error: error instanceof Error ? error.message : String(error)
          });
          // Continue even if recovery fails
        }
      }
      
      // Create progress callback for streaming updates
      const progressCallback = (taskId: string, progress: any) => {
        this.sendTaskProgress(taskId, progress);
      };
      
      this.secureManager = new GitIntegratedClaudeCodeManager(progressCallback, this.persistence || undefined);
      await this.secureManager.initialize();
      
      this.diffTools = new DiffManagementTools(this.secureManager);
      this.taskOrchestration = new ParallelTaskOrchestrationTools(this.secureManager);
      
      process.stderr.write('[Setup] 🔐 Secure containerized execution enabled\n');
      debugLog('Secure execution initialization complete');
    } catch (error) {
      process.stderr.write('⚠️ Secure execution failed to initialize - Docker may not be available\n');
      
      // Provide detailed error information
      if (error instanceof Error) {
        console.error('📍 Error details:', error.message);
        
        // Check for specific Docker-related errors
        if (error.message.includes('ENOENT') || error.message.includes('connect')) {
          console.error('🐳 Docker appears to be not installed or not running');
          console.error('   Please ensure Docker is installed and running:');
          console.error('   - macOS/Windows: Start Docker Desktop');
          console.error('   - Linux: sudo systemctl start docker');
          console.error('   - Verify with: docker ps');
        } else if (error.message.includes('permission denied')) {
          console.error('🔒 Docker permission issue detected');
          console.error('   - Linux: Add user to docker group: sudo usermod -aG docker $USER');
          console.error('   - Then logout and login again');
        } else if (error.message.includes('Dockerfile not found')) {
          console.error('📁 Missing Docker configuration files');
          console.error('   - Ensure you\'re running from the claude-parallel-work directory');
          console.error('   - Check that docker/claude-execution/Dockerfile exists');
        }
      }
      
      console.error('');
      console.error('💡 Run "claude-parallel-work health" for a detailed system check');
      console.error('⚠️ Task orchestration features will be unavailable until Docker is configured');
      
      this.secureManager = null;
      this.diffTools = null;
      this.taskOrchestration = null;
    }
  }

  /**
   * Perform startup cleanup tasks
   */
  private async performStartupCleanup(): Promise<void> {
    try {
      debugLog('Performing startup cleanup...');
      
      // Clean up old container logs (older than 24 hours)
      const { clearOldLogs } = await import('./tools/container-logs-tools.js');
      const logCleanupResult = await clearOldLogs({ 
        olderThanHours: 24 
      });
      debugLog('Log cleanup result:', logCleanupResult);
      
      // Clean up orphaned containers with claude-parallel prefix
      try {
        const Docker = (await import('dockerode')).default;
        const docker = new Docker();
        
        const containers = await docker.listContainers({ all: true });
        const claudeContainers = containers.filter((c: any) => 
          c.Names?.some((name: string) => name.includes('claude-parallel'))
        );
        
        let cleanedCount = 0;
        for (const containerInfo of claudeContainers) {
          try {
            const container = docker.getContainer(containerInfo.Id);
            
            // Remove stopped containers older than 1 hour
            if (containerInfo.State === 'exited') {
              const createdTime = new Date(containerInfo.Created * 1000);
              const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
              
              if (createdTime < oneHourAgo) {
                await container.remove({ force: true });
                cleanedCount++;
                debugLog(`Removed old container: ${containerInfo.Names?.[0]}`);
              }
            }
          } catch (err) {
            // Container might already be removed, ignore
            debugLog('Container cleanup error (ignored):', err);
          }
        }
        
        if (cleanedCount > 0) {
          debugLog(`Cleaned up ${cleanedCount} old containers`);
        }
        
      } catch (err) {
        debugLog('Docker container cleanup failed (non-critical):', err);
      }
      
      debugLog('Startup cleanup completed');
    } catch (error) {
      // Don't fail initialization if cleanup fails
      debugLog('Startup cleanup failed (non-critical):', error);
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const handleShutdown = async (signal: string) => {
      console.error(`[Shutdown] Received ${signal} signal. Graceful shutdown initiated.`);
      
      if (this.activeRequests.size > 0) {
        console.error(`[Shutdown] Waiting for ${this.activeRequests.size} active requests to complete...`);
        
        const shutdownTimeoutMs = 10000;
        const shutdownStart = Date.now();
        
        while (this.activeRequests.size > 0 && (Date.now() - shutdownStart) < shutdownTimeoutMs) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (this.activeRequests.size > 0) {
          console.error(`[Shutdown] ${this.activeRequests.size} requests still active after timeout.`);
        } else {
          console.error('[Shutdown] All active requests completed successfully.');
        }
      }


      // Shutdown secure components
      if (this.secureManager) {
        await this.secureManager.shutdown();
      }
      
      // Close persistence connection
      if (this.persistence) {
        try {
          this.persistence.close();
          logger.info('Persistence layer closed');
        } catch (error) {
          logger.error('Error closing persistence', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      await this.server.close();
      process.stderr.write('[Shutdown] Server closed. Exiting process.\n');
      process.exit(0);
    };
    
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }

  /**
   * Set up the MCP tool handlers
   */
  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [
//         {
//           name: 'break_down_to_work_plan',
//           description: `🧠 SMART WORK PLANNER - Transform complex tasks into optimized parallel execution plans

// **Triggers:** "plan this feature", "break down this task", "help me approach this complex work"

// **Use for:** Multi-file refactoring • Feature implementations • Complex bug fixes • Any task needing strategy

// **Creates:** tasks.json with parallel execution plan (2-5x faster than sequential)

// 📥 WORKFLOW: break_down → get_next_tasks → task_worker → set_task_status

// **Default:** Runs synchronously - waits for completion and returns full results
// **Background mode:** Set background=true for immediate response with monitoring info

// **Next steps (sync):**
// • review_changes - Review the generated tasks.json immediately
// • apply_changes - Apply tasks.json to your project
// • get_next_tasks - Find ready tasks to execute

// 💡 Pro tip: Synchronous mode is faster for feedback, background mode for large tasks

// **Quick:** break_down_to_work_plan taskDescription="refactor auth system" workFolder="/project"`,
//           inputSchema: {
//             type: 'object',
//             properties: {
//               taskDescription: {
//                 type: 'string',
//                 description: 'Describe the complex or multi-step development work you need done',
//               },
//               workFolder: {
//                 type: 'string', 
//                 description: 'Project directory where the work will be performed',
//               },
//               scope: {
//                 type: 'string',
//                 enum: ['small', 'medium', 'large', 'enterprise'],
//                 description: 'Expected scope of work (default: medium)',
//               },
//               prioritizeSpeed: {
//                 type: 'boolean',
//                 description: 'Optimize for parallel execution speed (default: true)',
//               },
//               allowParallel: {
//                 type: 'boolean', 
//                 description: 'Enable parallel task execution (default: true)',
//               },
//               context: {
//                 type: 'string',
//                 description: 'Additional context about the codebase, requirements, or constraints',
//               },
//               background: {
//                 type: 'boolean',
//                 description: 'Run in background mode for immediate response (default: false - synchronous)',
//               }
//             },
//             required: ['taskDescription', 'workFolder'],
//           } as any,
//         },
//         {
//           name: 'work_plan_from_docs',
//           description: `📋 REQUIREMENTS CONVERTER - Transform PRDs and specs into executable parallel task plans

// **Triggers:** "analyze this PRD", "convert requirements to tasks", "plan from this spec document"

// **Use for:** PRDs • Technical specs • Feature requests • Design docs • User stories • Planning documents

// **Creates:** tasks.json from your requirements document with optimized parallel execution

// 📥 WORKFLOW: work_plan_from_docs → get_next_tasks → task_worker → set_task_status

// **Default:** Runs synchronously - waits for completion and returns full results
// **Background mode:** Set background=true for immediate response with monitoring info

// **Next steps (sync):**
// • review_changes - Review the generated tasks.json immediately
// • apply_changes - Apply tasks.json to your project
// • get_next_tasks - Find ready tasks to execute

// 💡 Pro tip: Automatically extracts all development work from any requirements document

// **Quick:** work_plan_from_docs documentPath="/specs/feature.md" workFolder="/project"`,
//           inputSchema: {
//             type: 'object',
//             properties: {
//               documentPath: {
//                 type: 'string',
//                 description: 'Path to the markdown document containing requirements/specifications',
//               },
//               workFolder: {
//                 type: 'string', 
//                 description: 'Project directory where development work will be performed',
//               },
//               scope: {
//                 type: 'string',
//                 enum: ['small', 'medium', 'large', 'enterprise'],
//                 description: 'Expected scope of the work described in the document (default: medium)',
//               },
//               prioritizeSpeed: {
//                 type: 'boolean',
//                 description: 'Optimize for parallel execution speed (default: true)',
//               },
//               allowParallel: {
//                 type: 'boolean', 
//                 description: 'Enable parallel task execution (default: true)',
//               },
//               additionalContext: {
//                 type: 'string',
//                 description: 'Additional context about the codebase or constraints not in the document',
//               },
//               background: {
//                 type: 'boolean',
//                 description: 'Run in background mode for immediate response (default: false - synchronous)',
//               }
//             },
//             required: ['documentPath', 'workFolder'],
//           } as any,
//         },
      ];

      // Add secure execution tools (core feature)
      tools.push(
          {
            name: 'task_worker',
            description: `⚡ BACKGROUND TASK WORKER - Your primary tool for ALL development work in secure containers

**Triggers:** "fix bug in auth.js", "add error handling", "refactor to TypeScript", "write tests"

**Use for:** Code edits • File operations • Terminal commands • Git ops • Builds • Tests • Any dev work

**Returns:** taskId immediately for background monitoring (always runs in background mode)

⚡ WORKFLOW: task_worker → work_status → review_changes → apply_changes OR reject_changes

**Next steps:**
• work_status taskId="task_xyz" - Monitor execution progress and get container name
• review_changes - Inspect all modifications once complete
• apply_changes diffId="..." targetWorkspace="..." - Apply approved changes
• view_container_logs identifier="task_xyz" - View detailed execution logs

💡 3x faster than basic tools • Full git integration • Safe preview before applying

**Quick:** task_worker task="fix authentication bug" workFolder="/project"`,
            inputSchema: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'What you want to accomplish - any coding or development task',
                },
                workFolder: {
                  type: 'string',
                  description: 'Project directory (must be a git repository)',
                },
                parentTaskId: {
                  type: 'string',
                  description: 'Optional ID of parent task for orchestration',
                },
                returnMode: {
                  type: 'string',
                  enum: ['summary', 'full'],
                  description: 'How results should be returned (default: full)',
                },
                taskDescription: {
                  type: 'string',
                  description: 'Short description of the task',
                },
                containerConfig: {
                  type: 'object',
                  properties: {
                    memory: { type: 'string', description: 'Memory limit (e.g., "2g")' },
                    cpus: { type: 'string', description: 'CPU limit (e.g., "2")' },
                    timeout: { type: 'number', description: 'Timeout in milliseconds' }
                  },
                  description: 'Container resource configuration',
                }
              },
              required: ['task', 'workFolder'],
            } as any,
          },
          {
            name: 'review_changes',
            description: `🔍 CHANGE INSPECTOR - Preview all modifications before applying to your codebase

**Triggers:** "show me what changed", "review modifications", "see the diffs", "check changes"

**Shows:** Complete diffs • Risk assessment • File-by-file changes • Safety recommendations

🔍 WORKFLOW: task_worker → review_changes → apply_changes OR reject_changes

**Next steps:**
• apply_changes diffId="..." targetWorkspace="/project" - Merge approved changes
• request_revision diffId="..." feedback="..." - Request specific improvements
• reject_changes diffId="..." reason="..." - Permanently discard all changes
• view_container_logs identifier="task_xyz" - See detailed execution logs

💡 Pro tip: Always review changes, no matter how small - catches issues early

**Quick:** review_changes diffId="diff_123" format="detailed"`,
            inputSchema: {
              type: 'object',
              properties: {
                diffId: {
                  type: 'string',
                  description: 'Specific change ID to review (optional - shows all pending if not provided)',
                },
                showContent: {
                  type: 'boolean',
                  description: 'Include full diff content in response (default: true)',
                },
                format: {
                  type: 'string',
                  enum: ['summary', 'detailed'],
                  description: 'Level of detail in response (default: summary)',
                }
              },
            } as any,
          },
          {
            name: 'apply_changes',
            description: `✅ CHANGE APPLICATOR - Merge approved modifications into your project after review

**Triggers:** "apply these changes", "merge modifications", "commit updates", "make changes live"

**Does:** Safely merges approved changes • Maintains git history • Preserves file permissions

✅ WORKFLOW: task_worker → review_changes → apply_changes → continue development

**Next steps:**
• task_worker task="next feature" workFolder="/project" - Continue development
• system_status - Check environment health after large changes
• git commit -m "Applied changes" - Commit to version control

💡 Pro tip: Final step in secure workflow - all changes previewed before merging

**Quick:** apply_changes diffId="diff_123" targetWorkspace="/project"`,
            inputSchema: {
              type: 'object',
              properties: {
                diffId: {
                  type: 'string',
                  description: 'ID of the changes to apply to the workspace',
                },
                targetWorkspace: {
                  type: 'string',
                  description: 'Target workspace path to apply changes to',
                },
                confirm: {
                  type: 'boolean',
                  description: 'Confirm application after final review (default: true)',
                }
              },
              required: ['diffId', 'targetWorkspace'],
            } as any,
          },
          {
            name: 'reject_changes',
            description: `❌ CHANGE REJECTOR - Discard unwanted modifications and maintain code quality

**Triggers:** "reject changes", "discard modifications", "don't apply", "this looks wrong"

**Does:** Safely discards changes • Cleans up resources • Logs rejection reason • Preserves original code

❌ WORKFLOW: task_worker → review_changes → reject_changes (permanent) OR request_revision (iterate)

**Next steps:**
• task_worker task="alternative approach" workFolder="/project" - Start fresh
• request_revision diffId="diff_123" feedback="..." - Request specific improvements
• system_status - Ensure clean environment after rejection

💡 Pro tip: Consider request_revision instead - preserves working code while fixing issues

**Quick:** reject_changes diffId="diff_123" reason="Introduces security vulnerability"`,
            inputSchema: {
              type: 'object',
              properties: {
                diffId: {
                  type: 'string',
                  description: 'ID of the changes to reject and cleanup',
                },
                reason: {
                  type: 'string',
                  description: 'Optional reason for rejection (for logging)',
                }
              },
              required: ['diffId'],
            } as any,
          },
          {
            name: 'request_revision',
            description: `🔄 REVISION REQUEST - Iterate on changes based on feedback without losing context

**Triggers:** "revise these changes", "fix this issue in the diff", "update based on feedback"

**Does:** Preserves container context • Applies feedback • Generates new diff • Tracks revision history

🔄 WORKFLOW: review_changes → request_revision → work_status → review_changes (revised)

**Next steps:**
• work_status taskId="..." - Monitor revision execution
• review_changes - Review revised changes once complete
• apply_changes - Apply if revision addresses feedback

💡 Pro tip: More efficient than reject + retry - preserves working code

**Quick:** request_revision diffId="diff_123" feedback="Use async/await instead of callbacks"`,
            inputSchema: {
              type: 'object',
              properties: {
                diffId: {
                  type: 'string',
                  description: 'ID of the diff to revise',
                },
                feedback: {
                  type: 'string',
                  description: 'Specific feedback on what needs to be changed',
                },
                preserveCorrectParts: {
                  type: 'boolean',
                  description: 'Keep parts that are working correctly (default: true)',
                },
                additionalContext: {
                  type: 'string',
                  description: 'Extra guidance or context for the revision',
                }
              },
              required: ['diffId', 'feedback'],
            } as any,
          },
          {
            name: 'system_status',
            description: `🖥️ SYSTEM MONITOR - Check development environment health and resource usage

**Triggers:** "check system status", "show environment health", "container status", "resource usage"

**Shows:** Container pool • Resource usage • Active sessions • Performance metrics • System health

📊 WORKFLOW: Use weekly or after heavy workloads to ensure optimal performance

**Next steps:**
• dashboard_status - Check if visual monitoring available
• list_container_logs - View available execution logs
• Continue development with confidence

💡 Pro tip: Check weekly or after large operations to catch issues early

**Quick:** system_status`,
            inputSchema: {
              type: 'object',
              properties: {},
            } as any,
          },
          {
            name: 'work_status',
            description: `📊 EXECUTION MONITOR - Track background tasks and parallel work in real-time

**Triggers:** "check task status", "monitor execution", "show progress", "how's the task going"

**Monitors:** Background task execution • Parallel work plans • Container status • Progress updates

🔄 WORKFLOW: task_worker → work_status (monitor) → review_changes → apply_changes

**Next steps:**
• review_changes - Once task completes, review all modifications
• view_container_logs identifier="task_xyz" - See detailed execution logs
• answer_worker_question taskId="..." answer="..." - If status is needs_input

💡 Pro tip: Monitor long-running tasks while working on other things

**Quick:** work_status taskId="task_abc123"`,
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Background task ID to monitor (for code tool background tasks)',
                },
                planId: {
                  type: 'string',
                  description: 'Work plan ID to check (for parallel execution tasks)',
                },
                showDetails: {
                  type: 'boolean',
                  description: 'Include detailed task information (default: false)',
                }
              },
            } as any,
          }
        );

      // Add dashboard tools
      tools.push(
        {
          name: 'open_dashboard',
          description: `🎯 DASHBOARD LAUNCHER - Open real-time visual monitoring interface

**Triggers:** "open dashboard", "show monitoring interface", "launch dashboard", "visual monitor"

**Features:** Live task tracking • Container logs • Diff preview • WebSocket updates • Terminal UI

🎯 WORKFLOW: open_dashboard → monitor visually → interact with tasks in real-time

**Next steps:**
• dashboard_status - Check if server is running properly
• Monitor task execution visually in your browser
• Use terminal commands from dashboard for advanced control

💡 Pro tip: Best way to monitor multiple parallel tasks and container logs

**Quick:** open_dashboard
• 📊 Real-time task progress tracking
• 📱 Container log streaming with terminal interface
• 🔍 Diff management and change preview
• ⚡ WebSocket live updates

**Requirements:**
• Enhanced server must be running (use start:dashboard)
• Browser access for visual interface
• Node.js environment for dashboard server

**After using this tool:**
→ Dashboard opens in your default browser
→ Monitor all Claude Parallel Work activity visually
→ Use terminal commands for advanced monitoring`,
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          } as any,
        },
        {
          name: 'dashboard_status',
          description: `📊 DASHBOARD STATUS - Check if visual monitoring dashboard is available

**Triggers:** "is dashboard running", "check dashboard status", "dashboard setup", "dashboard health"

**Shows:** Running status • Server health • Build status • Access URLs • Setup instructions

🔧 WORKFLOW: dashboard_status → fix any issues → open_dashboard

**Next steps:**
• open_dashboard - Launch dashboard if everything is ready
• npm run start:dashboard - Start enhanced server if needed
• system_status - Check overall environment health

💡 Pro tip: Use this to troubleshoot dashboard connection issues

**Quick:** dashboard_status`,
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          } as any,
        },
        {
          name: 'init_project',
          description: `🚀 PROJECT INITIALIZER - Set up orchestration guidance for optimal parallel work

**Triggers:** "init project", "initialize parallel work", "set up orchestration", "create CLAUDE files"

**Creates:** 
• CLAUDE.parallelwork.md - Orchestration instructions for Claude
• Updates CLAUDE.md - Adds import reference

**Purpose:** Provides Claude with guidance on when to use parallel execution vs synchronous work

**Next steps:**
• Continue with your development tasks
• Claude will now optimize between parallel and synchronous execution

💡 Pro tip: Run this once per project for optimal performance

**Quick:** init_project workFolder="/project"`,
          inputSchema: {
            type: 'object',
            properties: {
              workFolder: {
                type: 'string',
                description: 'Project directory to initialize'
              },
              force: {
                type: 'boolean',
                description: 'Overwrite existing files (default: false)'
              }
            },
            required: ['workFolder']
          } as any,
        },
        {
          name: 'view_container_logs',
          description: `📜 LOG VIEWER - View detailed execution logs from any container

**Triggers:** "show logs for task", "view container output", "check execution details"

**Use for:** Debugging failures • Monitoring progress • Understanding execution flow

🔍 WORKFLOW: task_worker → work_status → view_container_logs (for details)

**Next steps:**
• list_container_logs - Find other available log files
• review_changes - After understanding execution, review modifications
• work_status taskId="..." - Check task execution status

💡 Pro tip: Essential for debugging when tasks fail or behave unexpectedly

**Quick:** view_container_logs identifier="task_abc123" tail=100`,
          inputSchema: {
            type: 'object',
            properties: {
              identifier: {
                type: 'string',
                description: 'Task ID (e.g., task-123) or container ID to view logs for'
              },
              tail: {
                type: 'number',
                description: 'Number of lines from the end to show (optional, default: all)'
              },
              filter: {
                type: 'string',
                description: 'Filter lines containing this text (optional)'
              }
            },
            required: ['identifier']
          } as any,
        },
        {
          name: 'list_container_logs',
          description: `📂 LOG FINDER - List all available container execution logs

**Triggers:** "show available logs", "list log files", "find container logs"

**Shows:** Recent log files • File sizes • Timestamps • Container IDs

🗑️ WORKFLOW: list_container_logs → view_container_logs → clear_old_logs

**Next steps:**
• view_container_logs identifier="..." - View specific log content
• system_status - Check overall environment health
• task_worker - Continue with development tasks

💡 Pro tip: Check regularly to manage disk space and find historical executions

**Quick:** list_container_logs limit=10 sortBy="newest"`,
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of log files to return (default: 20)'
              },
              sortBy: {
                type: 'string',
                enum: ['newest', 'oldest', 'size'],
                description: 'Sort order for log files (default: newest)'
              }
            }
          } as any,
        },
        {
          name: 'validate_tasks',
          description: `✓ TASKS VALIDATOR - Verify tasks.json format and integrity

**Triggers:** "validate tasks", "check tasks.json", "verify task format"

**Shows:** Format validation • Dependency checks • Task statistics • Detailed diagnostics

📋 WORKFLOW: validate_tasks → fix issues → get_next_tasks → task_worker

**Features:**
• Validates JSON syntax and schema compliance
• Checks for duplicate IDs and circular dependencies
• Verifies all dependencies reference existing tasks
• Provides detailed error messages and warnings
• Comprehensive task statistics

**Next steps:**
• Edit tasks.json to fix any validation errors
• get_next_tasks workFolder="/project" - Find executable tasks

💡 Pro tip: Run validation after manual edits or before starting execution

**Quick:** validate_tasks workFolder="/project"`,
          inputSchema: {
            type: 'object',
            properties: {
              workFolder: {
                type: 'string',
                description: 'Project directory containing tasks.json'
              }
            },
            required: ['workFolder']
          } as any,
        },
        {
          name: 'answer_worker_question',
          description: `💬 INTERACTIVE RESPONDER - Answer Claude's questions during execution

**Triggers:** When work_status shows "needs_input" status

**Use for:** Providing clarification • Making decisions • Supplying missing information

🔄 WORKFLOW: task_worker → work_status (needs_input) → answer_worker_question → work_status

**Next steps:**
• work_status taskId="..." - Check if execution resumed
• view_container_logs - See the conversation context
• Continue monitoring until task completes

💡 Pro tip: Enables interactive sessions where Claude asks for guidance

**Quick:** answer_worker_question taskId="task_abc123" answer="Use the production database"`,
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'The task ID that is waiting for input'
              },
              answer: {
                type: 'string',
                description: 'Your answer to Claude\'s question'
              }
            },
            required: ['taskId', 'answer']
          } as any,
        },
      );

      // Add task management tools (available regardless of secure execution)
      if (this.taskManagement) {
        tools.push(
          {
            name: 'set_task_status',
            description: `📝 TASK STATUS UPDATER - Track progress through your execution plan

**Triggers:** "mark task 1 done", "set task 2 in-progress", "task 3 failed", "update statuses"

**Statuses:** pending • in-progress • done • failed (with error message)

✅ WORKFLOW: get_next_tasks → task_worker → set_task_status → get_next_tasks

**Next steps:**
• get_next_tasks - Find more ready tasks after marking done
• get_tasks status="in-progress" - See what's currently running
• get_task id=X - View details of specific task

💡 Pro tip: Update immediately after completing each task to unlock dependencies

**Quick:** set_task_status ids="1,2,3" status="done" workFolder="/project"`,
            inputSchema: {
              type: 'object',
              properties: {
                ids: {
                  type: 'string',
                  description: 'Task/subtask ID(s) to update. Examples: "1" or "1,2,3" or "1.2" or "1,1.2,2"'
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in-progress', 'done', 'failed'],
                  description: 'New status for the task(s)'
                },
                workFolder: {
                  type: 'string',
                  description: 'Project directory containing tasks.json'
                },
                error: {
                  type: 'string',
                  description: 'Error message (only for failed status)'
                }
              },
              required: ['ids', 'status', 'workFolder']
            } as any,
          },
          {
            name: 'get_task',
            description: `🔍 TASK DETAILS VIEWER - Get complete information about a specific task

**Triggers:** "show task 5", "task 3 details", "get task info", "what's task 2 about"

**Shows:** Title • Status • Priority • Implementation details • Dependencies • Test strategy

📋 WORKFLOW: get_task → task_worker → set_task_status → get_next_tasks

**Next steps:**
• task_worker task="implement task X" workFolder="/project" - Execute the task
• set_task_status ids="X" status="in-progress" - Mark as started
• get_tasks - View all tasks in context

💡 Pro tip: Always check dependencies before starting a task

**Quick:** get_task id=5 workFolder="/project"`,
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Task ID to retrieve'
                },
                workFolder: {
                  type: 'string',
                  description: 'Project directory containing tasks.json'
                }
              },
              required: ['id', 'workFolder']
            } as any,
          },
          {
            name: 'get_tasks',
            description: `📊 TASK LIST VIEWER - See all tasks with status overview and filtering

**Triggers:** "show all tasks", "list pending tasks", "what's in progress", "task summary"

**Shows:** Status counts • Grouped tasks • Blocked vs ready • Priority ordering

📊 WORKFLOW: get_tasks → choose tasks → get_task → task_worker

**Next steps:**
• get_next_tasks - Find ready tasks to work on
• get_task id=X - View specific task details
• set_task_status - Update task progress

💡 Pro tip: Use status filter to focus on specific task states

**Quick:** get_tasks workFolder="/project" status="pending"`,
            inputSchema: {
              type: 'object',
              properties: {
                workFolder: {
                  type: 'string',
                  description: 'Project directory containing tasks.json'
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in-progress', 'done', 'failed'],
                  description: 'Filter by specific status (optional)'
                },
                includeBlocked: {
                  type: 'boolean',
                  description: 'Include tasks with unmet dependencies (default: true)'
                }
              },
              required: ['workFolder']
            } as any,
          },
          {
            name: 'get_next_tasks',
            description: `🚀 NEXT TASK FINDER - Get ALL tasks ready for parallel execution

**Triggers:** "what tasks can I work on", "get next tasks", "show ready tasks", "what's next"

**Returns:** All tasks with satisfied dependencies • Prioritized by importance • Ready for parallel execution

🚀 WORKFLOW: get_next_tasks → task_worker (multiple parallel) → set_task_status → repeat

**Next steps:**
• task_worker task="..." workFolder="/project" - Execute each ready task
• set_task_status ids="X,Y,Z" status="in-progress" - Mark multiple as started
• work_status - Monitor parallel execution progress

💡 Pro tip: Primary workflow tool - finds all parallelizable work automatically

**Quick:** get_next_tasks workFolder="/project"`,
            inputSchema: {
              type: 'object',
              properties: {
                workFolder: {
                  type: 'string',
                  description: 'Project directory containing tasks.json'
                },
                limit: {
                  type: 'number',
                  description: 'Max number of tasks to return (optional, default: all eligible)'
                }
              },
              required: ['workFolder']
            } as any,
          }
        );
      }

      return { tools } as any;
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (args): Promise<ServerResult> => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      this.activeRequests.add(requestId);
      
      debugLog(`Handling CallToolRequest: ${requestId}`, args);

      const fullToolName = args.params.name;
      const toolName = fullToolName.includes(':') ? fullToolName.split(':')[1] : fullToolName;
      
      debugLog(`Tool request: ${fullToolName}, Local tool name: ${toolName}`);
      
      // Log tool invocation
      const startTime = Date.now();
      logger.info(`Tool invoked: ${toolName}`, {
        requestId,
        toolName,
        fullToolName,
        arguments: JSON.stringify(args.params.arguments).substring(0, 500)
      });

      try {
        let result: ServerResult;

        switch (toolName) {
          // case 'break_down_to_work_plan':
          //   result = await this.handleBreakDownToWorkPlanWithMonitoring(args.params.arguments);
          //   break;
          // case 'work_plan_from_docs':
          //   result = await this.handleWorkPlanFromDocs(args.params.arguments);
          //   break;
          case 'task_worker':
            result = await this.handleTaskWorker(args.params.arguments);
            break;
          case 'review_changes':
            result = await this.handleReviewChanges(args.params.arguments);
            break;
          case 'apply_changes':
            result = await this.handleApplyChanges(args.params.arguments);
            break;
          case 'reject_changes':
            result = await this.handleRejectChanges(args.params.arguments);
            break;
          case 'request_revision':
            result = await this.handleRequestRevision(args.params.arguments);
            break;
          case 'system_status':
            result = await this.handleSystemStatus();
            break;
          case 'work_status':
            result = await this.handleWorkStatus(args.params.arguments);
            break;
          case 'open_dashboard':
            result = await this.handleOpenDashboard();
            break;
          case 'dashboard_status':
            result = await this.handleDashboardStatus();
            break;
          case 'init_project':
            result = await this.handleInitProject(args.params.arguments);
            break;
          case 'view_container_logs':
            result = await this.handleViewContainerLogs(args.params.arguments);
            break;
          case 'list_container_logs':
            result = await this.handleListContainerLogs(args.params.arguments);
            break;
          case 'validate_tasks':
            result = await this.handleValidateTasks(args.params.arguments);
            break;
          case 'answer_worker_question':
            result = await this.handleAnswerClaudeQuestion(args.params.arguments);
            break;
          case 'set_task_status':
            result = await this.handleSetTaskStatus(args.params.arguments);
            break;
          case 'get_task':
            result = await this.handleGetTask(args.params.arguments);
            break;
          case 'get_tasks':
            result = await this.handleGetTasks(args.params.arguments);
            break;
          case 'get_next_tasks':
            result = await this.handleGetNextTasks(args.params.arguments);
            break;
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
        }

        this.activeRequests.delete(requestId);
        debugLog(`Request ${requestId} completed successfully`);
        // Log successful completion
        logger.info(`Tool completed: ${toolName}`, {
          requestId,
          toolName,
          duration: Date.now() - startTime,
          success: true
        });
        
        return result;

      } catch (error) {
        this.activeRequests.delete(requestId);
        debugLog(`Request ${requestId} failed:`, error);
        
        // Log error
        logger.error(`Tool failed: ${toolName}`, {
          requestId,
          toolName,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        throw error;
      }
    });
  }


  /**
   * Handle break down to work plan
   */
  private async handleBreakDownToWorkPlanWithMonitoring(toolArguments: any): Promise<ServerResult> {
    if (!this.taskOrchestration) {
      throw new McpError(
        ErrorCode.InternalError, 
        'Task orchestration not available. Docker is required but not properly configured.\n\n' +
        'Please ensure:\n' +
        '1. Docker is installed and running\n' +
        '2. Your user has Docker permissions\n' +
        '3. Run "claude-parallel-work health" for detailed diagnostics\n\n' +
        'Without Docker, task breakdown and parallel execution features are disabled.'
      );
    }

    const result = await this.taskOrchestration.breakdownProject(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle work plan from docs requests
   */
  private async handleWorkPlanFromDocs(toolArguments: any): Promise<ServerResult> {
    if (!this.taskOrchestration) {
      throw new McpError(
        ErrorCode.InternalError,
        'Task orchestration not available. Docker is required but not properly configured.\n\n' +
        'Please ensure:\n' +
        '1. Docker is installed and running\n' +
        '2. Your user has Docker permissions\n' +
        '3. Run "claude-parallel-work health" for detailed diagnostics\n\n' +
        'Without Docker, task breakdown and parallel execution features are disabled.'
      );
    }

    if (!toolArguments?.documentPath || !toolArguments?.workFolder) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters: documentPath, workFolder');
    }

    try {
      // Read the markdown file
      const markdownContent = await fs.readFile(toolArguments.documentPath, 'utf8');
      
      // Create enhanced description combining markdown content with additional context
      let enhancedDescription = `Based on this document:\n\n${markdownContent}`;
      
      if (toolArguments.additionalContext) {
        enhancedDescription += `\n\nAdditional Context:\n${toolArguments.additionalContext}`;
      }

      // Convert to breakdownProject format
      const breakdownArgs = {
        taskDescription: enhancedDescription,
        workFolder: toolArguments.workFolder,
        scope: toolArguments.scope || 'medium',
        prioritizeSpeed: toolArguments.prioritizeSpeed !== false,
        allowParallel: toolArguments.allowParallel !== false,
        context: `Source document: ${toolArguments.documentPath}`,
        background: toolArguments.background ?? false // Default to synchronous
      };

      const result = await this.taskOrchestration.breakdownProject(breakdownArgs);
      return { content: [{ type: 'text', text: result }] };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to read markdown file: ${errorMessage}`);
    }
  }

  /**
   * Handle task worker requests - always runs in background mode
   */
  private async handleTaskWorker(toolArguments: any): Promise<ServerResult> {
    if (!this.secureManager) {
      throw new McpError(ErrorCode.InternalError, 'Secure execution not available. Check Docker installation and initialization.');
    }

    if (!toolArguments?.task) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: task');
    }

    if (!toolArguments?.workFolder) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: workFolder (must be a git repository)');
    }

    const secureArgs: GitIntegratedExecutionArgs = {
      prompt: toolArguments.task,
      workFolder: toolArguments.workFolder,
      background: true, // Always run in background mode
      parentTaskId: toolArguments.parentTaskId,
      returnMode: toolArguments.returnMode || 'full',
      taskDescription: toolArguments.taskDescription || toolArguments.task, // Default to task if no description
      speedMode: 'fast', // Always use warm containers
      containerConfig: toolArguments.containerConfig
    };

    try {
      debugLog('Executing secure Claude Code:', secureArgs);
      
      // Track in dashboard if enabled
      if (this.dashboardEnabled) {
        const repoId = this.addRepository(toolArguments.workFolder);
        // Task tracking will be handled by the secure manager's progress callbacks
      }
      
      const result = await this.secureManager.execute(secureArgs);
      
      if (result.success) {
        return { content: [{ type: 'text', text: result.output || '' }] };
      } else {
        throw new McpError(ErrorCode.InternalError, `Secure execution failed: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Secure Claude Code execution failed: ${errorMessage}`);
    }
  }


  /**
   * Handle review changes requests
   */
  private async handleReviewChanges(toolArguments: any): Promise<ServerResult> {
    if (!this.diffTools) {
      throw new McpError(ErrorCode.InternalError, 'Diff management not available.');
    }

    const result = await this.diffTools.reviewPendingDiffs(toolArguments || {});
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle apply changes requests
   */
  private async handleApplyChanges(toolArguments: any): Promise<ServerResult> {
    if (!this.diffTools) {
      throw new McpError(ErrorCode.InternalError, 'Diff management not available.');
    }

    if (!toolArguments?.diffId || !toolArguments?.targetWorkspace) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters: diffId, targetWorkspace');
    }

    const result = await this.diffTools.applyDiff(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle reject changes requests
   */
  private async handleRejectChanges(toolArguments: any): Promise<ServerResult> {
    if (!this.diffTools) {
      throw new McpError(ErrorCode.InternalError, 'Diff management not available.');
    }

    if (!toolArguments?.diffId) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: diffId');
    }

    const result = await this.diffTools.rejectDiff(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle request revision
   */
  private async handleRequestRevision(toolArguments: any): Promise<ServerResult> {
    if (!this.diffTools) {
      throw new McpError(ErrorCode.InternalError, 'Diff management not available.');
    }

    if (!toolArguments?.diffId || !toolArguments?.feedback) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters: diffId, feedback');
    }

    const result = await this.diffTools.requestRevision(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle system status requests
   */
  private async handleSystemStatus(): Promise<ServerResult> {
    if (!this.diffTools) {
      throw new McpError(ErrorCode.InternalError, 'Security status not available.');
    }

    const result = await this.diffTools.getSecurityStatus();
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle work status requests
   */
  private async handleWorkStatus(toolArguments: any): Promise<ServerResult> {
    const { taskId, workFolder } = toolArguments || {};
    
    // Handle background code execution tasks
    if (taskId && !workFolder) {
      if (!this.secureManager) {
        throw new McpError(ErrorCode.InternalError, 'Secure execution manager not available.');
      }
      
      const backgroundTask = await this.secureManager.getBackgroundTaskStatus(taskId);
      
      if (!backgroundTask) {
        return { content: [{ type: 'text', text: `Background task ${taskId} not found.` }] };
      }
      
      const task = backgroundTask as any; // BackgroundTask type
      const duration = task.endTime 
        ? task.endTime.getTime() - task.startTime.getTime()
        : Date.now() - task.startTime.getTime();
      
      const statusReport = {
        taskId: task.id,
        status: task.status,
        progress: task.progress || 'No progress information',
        startTime: task.startTime.toISOString(),
        endTime: task.endTime?.toISOString(),
        duration: `${Math.round(duration / 1000)} seconds`,
        error: task.error,
        pendingQuestion: task.pendingQuestion,
        sessionId: task.sessionId,
        result: task.result ? {
          diffId: task.result.diffId,
          containerId: task.result.containerId,
          worktreeId: task.result.worktreeId,
          filesChanged: task.result.diffSummary?.filesChanged || 0
        } : null
      };
      
      const statusText = `**Task ID**: ${statusReport.taskId} | **Status**: ${statusReport.status.toUpperCase()} | **Progress**: ${statusReport.progress} | **Duration**: ${statusReport.duration} | **Started**: ${statusReport.startTime}
${statusReport.endTime ? ` **Completed**: ${statusReport.endTime}` : ''}${statusReport.status === 'completed' && statusReport.result ? ` **Diff ID**: ${statusReport.result.diffId || 'No changes'} | **Container**: ${statusReport.result.containerId} | **Files Changed**: ${statusReport.result.filesChanged}${statusReport.status === 'failed' ? ` **Error**: ${statusReport.error}` : ''}${statusReport.result.diffId ? '✅ Use `review_changes` to see what changed, then `apply_changes` to merge.' : '✅ Task completed with no file changes.'}` : ''}
${statusReport.status === 'running' ? ` ⏳ **Task is still executing...** | 🔍 **Watch logs:** \`view_container_logs --identifier "${statusReport.taskId}"\` or \`tail -f "src/logs/$(docker ps -qf "name=claude-parallel-${statusReport.taskId}" | head -c 12)-${statusReport.taskId}.log"\`` : ''}
${statusReport.status === 'needs_input' ? ` 🤔 **Claude is asking a question:** ${statusReport.pendingQuestion}
### How to respond:
\`\`\`
answer_worker_question taskId="${statusReport.taskId}" answer="Your answer here"
\`\`\`
The container is still running and waiting for your response.
` : ''}`;

      return { content: [{ type: 'text', text: statusText }] };
    }
    
    // Handle task plan status from files
    if (!this.taskOrchestration) {
      throw new McpError(ErrorCode.InternalError, 'Task orchestration not available.');
    }

    const result = await this.taskOrchestration.getTaskStatus(toolArguments || {});
    return { content: [{ type: 'text', text: result }] };
  }


  /**
   * Handle open dashboard requests
   */
  private async handleOpenDashboard(): Promise<ServerResult> {
    try {
      // Enable dashboard mode when dashboard is opened
      this.enableDashboard();
      
      const result = await launchDashboard();
      
      if (result.status === 'error') {
        const errorResponse = `❌ **Dashboard Launch Failed**

**Issue**: Enhanced server is not running on port 47821.

**Solution**:
1. **Start the enhanced server first:**
   \`\`\`bash
   npm run start:dashboard
   \`\`\`

2. **Then try opening the dashboard again**

**Need help?** Use \`dashboard_status\` to check configuration.`;
        
        return { content: [{ type: 'text', text: errorResponse }] };
      }
      
      const successResponse = `🚀 **Dashboard Launched Successfully!**

**Dashboard URL**: ${result.url}
**Status**: Browser should open automatically
**Enhanced Server**: ✅ Running on port 47821

**Dashboard Features Now Available**:
• 🔄 Live repository monitoring
• 📊 Real-time task progress tracking  
• 📱 Container log streaming
• 🔍 Diff management interface
• ⚡ WebSocket live updates

**Manual Access**: If browser didn't open automatically, visit:
**${result.url}**

**Monitor Commands**:
• \`docker ps | grep claude-parallel\` - View active containers
• \`tmux list-sessions\` - See monitoring sessions
• \`dashboard_status\` - Check dashboard health`;
      
      return { content: [{ type: 'text', text: successResponse }] };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failureResponse = `❌ **Dashboard Launch Error**

**Error**: ${errorMessage}

**Troubleshooting Steps**:
1. Check if enhanced server is running: \`npm run start:dashboard\`
2. Verify dashboard dependencies: \`cd dashboard && npm install\`
3. Check port availability: \`lsof -i :5173 -i :47821\`
4. Review dashboard status: \`dashboard_status\`

**Need Setup Help?**
Use \`dashboard_status\` for detailed configuration info.`;
      
      return { content: [{ type: 'text', text: failureResponse }] };
    }
  }

  /**
   * Handle project initialization
   */
  private async handleInitProject(args: any): Promise<ServerResult> {
    try {
      const result = await InitTool.initializeProject(args);
      
      return {
        content: [
          {
            type: 'text',
            text: result
          }
        ]
      };
    } catch (error: any) {
      logger.error('Failed to initialize project:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize project: ${error.message}`
      );
    }
  }

  /**
   * Handle dashboard status requests
   */
  private async handleDashboardStatus(): Promise<ServerResult> {
    try {
      const status = await checkDashboardStatus();
      const setupInstructions = getDashboardSetupInstructions();
      
      const statusEmoji = {
        dashboard: status.isRunning ? '✅' : '❌',
        server: status.serverRunning ? '✅' : '❌',
        build: status.dashboardBuilt ? '✅' : '⚠️'
      };
      
      const statusResponse = `📊 **Claude Parallel Work Dashboard Status**

**Component Status**:
• **Dashboard Server**: ${statusEmoji.dashboard} ${status.isRunning ? `Running on ${status.url}` : 'Not running'}
• **Enhanced Server**: ${statusEmoji.server} ${status.serverRunning ? 'Running on port 47821' : 'Not running on port 47821'}
• **Dashboard Build**: ${statusEmoji.build} ${status.dashboardBuilt ? 'Built and ready' : 'Not built yet'}

${!status.isRunning || !status.serverRunning ? `
**⚠️ Action Required**:
${!status.serverRunning ? '1. Start enhanced server: \`npm run start:dashboard\`\n' : ''}${!status.isRunning ? '2. Start dashboard: \`npm run dashboard\`\n' : ''}
` : ''}

${status.isRunning && status.serverRunning ? `
**🎯 Ready to Use**:
• Dashboard: ${status.url}
• Use \`open_dashboard\` to launch in browser
• All features are operational

` : ''}

**Port Information**:
• Dashboard: 5173 (development server)
• Enhanced Server: 47821 (streaming & API)
• Required: Both ports must be available

${setupInstructions}`;
      
      return { content: [{ type: 'text', text: statusResponse }] };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error checking dashboard status: ${errorMessage}` }] };
    }
  }


  /**
   * Broadcast update to all streaming clients
   */
  protected broadcastUpdate(update: any): void {
    const message = {
      jsonrpc: '2.0' as const,
      method: 'notifications/progress' as const,
      params: update
    };
    
    this.streamingClients.forEach(client => {
      try {
        if (client.send) {
          client.send(message);
        }
      } catch (error) {
        console.error('Failed to send update to client:', error);
      }
    });
  }

  /**
   * Send task progress update via streaming
   */
  private sendTaskProgress(taskId: string, progress: any): void {
    this.broadcastUpdate({
      type: 'task_progress',
      taskId,
      ...progress
    });
  }

  /**
   * Handle view container logs requests
   */
  private async handleViewContainerLogs(toolArguments: any): Promise<ServerResult> {
    const result = await handleContainerLogsTools('view_container_logs', toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle list container logs requests
   */
  private async handleListContainerLogs(toolArguments: any): Promise<ServerResult> {
    const result = await handleContainerLogsTools('list_container_logs', toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle validate tasks requests
   */
  private async handleValidateTasks(toolArguments: any): Promise<ServerResult> {
    const result = await handleTasksValidationTools('validate_tasks', toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }


  /**
   * Handle answer Claude question requests
   */
  private async handleAnswerClaudeQuestion(toolArguments: any): Promise<ServerResult> {
    if (!this.secureManager) {
      throw new McpError(ErrorCode.InternalError, 'Secure execution not available.');
    }

    const { taskId, answer } = toolArguments || {};
    
    if (!taskId || !answer) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters: taskId, answer');
    }

    try {
      const result = await this.secureManager.answerClaudeQuestion(taskId, answer);
      
      // Now it returns a string message immediately
      return { content: [{ type: 'text', text: result }] };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to answer question: ${errorMessage}`);
    }
  }

  /**
   * Handle set task status requests
   */
  private async handleSetTaskStatus(toolArguments: any): Promise<ServerResult> {
    if (!this.taskManagement) {
      throw new McpError(ErrorCode.InternalError, 'Task management not available.');
    }

    const result = await this.taskManagement.setTaskStatus(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle get task requests
   */
  private async handleGetTask(toolArguments: any): Promise<ServerResult> {
    if (!this.taskManagement) {
      throw new McpError(ErrorCode.InternalError, 'Task management not available.');
    }

    const result = await this.taskManagement.getTask(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle get tasks requests
   */
  private async handleGetTasks(toolArguments: any): Promise<ServerResult> {
    if (!this.taskManagement) {
      throw new McpError(ErrorCode.InternalError, 'Task management not available.');
    }

    const result = await this.taskManagement.getTasks(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Handle get next tasks requests
   */
  private async handleGetNextTasks(toolArguments: any): Promise<ServerResult> {
    if (!this.taskManagement) {
      throw new McpError(ErrorCode.InternalError, 'Task management not available.');
    }

    const result = await this.taskManagement.getNextTasks(toolArguments);
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Start streaming HTTP server for real-time updates
   */
  async startStreamingServer(port = 47821): Promise<void> {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers for web clients
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      if (req.method === 'GET' && req.url === '/stream') {
        // Create SSE transport for streaming updates
        const sseTransport = new SSEServerTransport('/stream', res);
        
        // Track streaming client
        this.streamingClients.add(sseTransport);
        
        console.error(`🔄 Streaming client connected from ${req.socket.remoteAddress}`);
        
        // Start the SSE connection
        await sseTransport.start();
        
        // Handle disconnect
        req.on('close', () => {
          this.streamingClients.delete(sseTransport);
          console.error('🔌 Streaming client disconnected');
        });
        
      } else if (req.method === 'GET' && req.url === '/status') {
        // Simple status endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'running',
          streaming: true,
          dashboardEnabled: this.dashboardEnabled,
          endpoints: {
            stream: '/stream',
            status: '/status',
            ...(this.dashboardEnabled ? {
              repositories: '/api/repositories',
              tasks: '/api/tasks',
              containers: '/api/containers',
              diffs: '/api/diffs'
            } : {})
          }
        }));
      } else if (req.url?.startsWith('/api/') && this.dashboardEnabled) {
        // Handle dashboard API requests when enabled
        await this.handleDashboardAPI(req, res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    return new Promise<void>((resolve, reject) => {
      httpServer.listen(port, () => {
        console.error(`🌐 Streaming server started on http://localhost:${port}`);
        console.error(`   Stream endpoint: http://localhost:${port}/stream`);
        console.error(`   Status endpoint: http://localhost:${port}/status`);
        if (this.dashboardEnabled) {
          console.error(`📊 Dashboard API available at http://localhost:${port}/api/*`);
        }
        resolve();
      });
      
      httpServer.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Try setting CLAUDE_PARALLEL_STREAM_PORT to a different port.`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Enable dashboard functionality
   */
  public enableDashboard(): void {
    if (!this.dashboardEnabled) {
      this.dashboardEnabled = true;
      console.error('[Dashboard] 🖥️ Dashboard API enabled');
    }
  }

  /**
   * Add or update repository
   */
  private addRepository(workFolder: string): string {
    const repoId = Buffer.from(workFolder).toString('base64url');
    const repoName = path.basename(workFolder);
    
    if (!this.repositories.has(repoId)) {
      const repo: Repository = {
        id: repoId,
        name: repoName,
        path: workFolder,
        isActive: false,
        taskCount: 0,
        containerCount: 0,
        diffCount: 0,
        lastActivity: new Date()
      };
      this.repositories.set(repoId, repo);
      if (this.dashboardEnabled) {
        console.error(`[Dashboard] Added repository: ${repoName} (${repoId})`);
      }
    }
    
    return repoId;
  }

  /**
   * Update repository activity
   */
  private updateRepositoryActivity(repoId: string): void {
    const repo = this.repositories.get(repoId);
    if (repo) {
      const tasks = Array.from(this.tasks.values()).filter(t => t.repoId === repoId);
      const containers = Array.from(this.containers.values()).filter(c => c.repoId === repoId);
      const diffs = Array.from(this.diffs.values()).filter(d => d.repoId === repoId);
      
      repo.taskCount = tasks.length;
      repo.containerCount = containers.filter(c => c.status === 'running').length;
      repo.diffCount = diffs.filter(d => d.status === 'pending').length;
      repo.isActive = repo.taskCount > 0 || repo.containerCount > 0 || repo.diffCount > 0;
      repo.lastActivity = new Date();
      
      this.repositories.set(repoId, repo);
      
      if (this.dashboardEnabled) {
        this.broadcastUpdate({
          type: 'repo_activity',
          repoId,
          activity: {
            taskCount: repo.taskCount,
            containerCount: repo.containerCount,
            diffCount: repo.diffCount,
            isActive: repo.isActive
          }
        });
      }
    }
  }

  /**
   * Handle dashboard API requests
   */
  private async handleDashboardAPI(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathname = url.pathname;
    
    // All responses are JSON
    res.setHeader('Content-Type', 'application/json');
    
    try {
      switch (pathname) {
        case '/api/repositories':
          const repos = Array.from(this.repositories.values());
          res.writeHead(200);
          res.end(JSON.stringify(repos));
          break;
          
        case '/api/tasks':
          const tasks = Array.from(this.tasks.values());
          res.writeHead(200);
          res.end(JSON.stringify(tasks));
          break;
          
        case '/api/containers':
          const containers = Array.from(this.containers.values());
          res.writeHead(200);
          res.end(JSON.stringify(containers));
          break;
          
        case '/api/diffs':
          const diffs = Array.from(this.diffs.values());
          res.writeHead(200);
          res.end(JSON.stringify(diffs));
          break;
          
        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  /**
   * Start the enhanced MCP server
   */
  async run(): Promise<void> {
    logger.info('Starting Claude Parallel Work MCP server', {
      version: packageJson.version,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    });
    
    try {
      // Start stdio transport (primary)
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      logger.info('MCP server connected to stdio transport');
      process.stderr.write('Claude Parallel Work MCP server running on stdio - 🔐 Secure Containerized Execution\n');
      
      // Start streaming server for real-time updates
      const streamingPort = parseInt(process.env.CLAUDE_PARALLEL_STREAM_PORT || '47821');
      if (process.env.CLAUDE_PARALLEL_ENABLE_STREAMING !== 'false') {
        try {
          await this.startStreamingServer(streamingPort);
          logger.info('Streaming server started', { port: streamingPort });
        } catch (error) {
          logger.warn('Streaming server disabled', {
            error: error instanceof Error ? error.message : String(error)
          });
          console.error(`⚠️ Streaming server disabled: ${error instanceof Error ? error.message : error}`);
          console.error(`💡 MCP server will continue without real-time streaming features`);
        }
      }
      
      if (!this.secureManager) {
        logger.warn('Secure execution not available - Docker may not be configured');
        process.stderr.write('⚠️ Secure execution failed to initialize - Docker may not be available\n');
      } else {
        logger.info('Secure execution manager initialized successfully');
      }
      
      logger.info('Server startup complete');
    } catch (error) {
      logger.error('Server startup failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}

// Export the class for potential external use
export { ClaudeParallelWorkServer };

// Create and run the enhanced server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('Claude Parallel Work MCP server starting from command line', {
    args: process.argv,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      MCP_CLAUDE_DEBUG: process.env.MCP_CLAUDE_DEBUG,
      CLAUDE_PARALLEL_DEBUG_NO_CLEANUP: process.env.CLAUDE_PARALLEL_DEBUG_NO_CLEANUP
    }
  });

  const server = new ClaudeParallelWorkServer();
  
  // Enable dashboard if --dashboard flag is passed or ENABLE_DASHBOARD env var is set
  if (process.argv.includes('--dashboard') || process.env.ENABLE_DASHBOARD === 'true') {
    server.enableDashboard();
    logger.info('Dashboard API enabled');
    console.error('📊 Starting server with dashboard API enabled');
  }
  
  server.run().catch(error => {
    logger.error('Fatal server error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error(error);
    process.exit(1);
  });
}
