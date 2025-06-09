/**
 * Docker Environment Management Tools
 * 
 * MCP tools for managing Docker environment and ensuring secure execution containers can run
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import { existsSync } from 'fs';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { debugLog } from './debug.js';
import { ContainerManager } from '../docker/containerManager.js';

const execAsync = promisify(exec);

export interface DockerStatus {
  dockerAvailable: boolean;
  dockerRunning: boolean;
  dockerProvider: 'docker-desktop' | 'colima' | 'native' | 'unknown';
  colimaStatus?: string;
  containerEngineRunning: boolean;
  secureExecutionAvailable: boolean;
  errors: string[];
  suggestions: string[];
}

export class DockerEnvironmentTools {
  private docker: Docker | null = null;
  private containerManager: ContainerManager | null = null;

  constructor() {
    // Don't initialize Docker here - wait for checkDockerStatus
  }

  /**
   * Fix Docker environment - one-stop solution for Docker issues
   */
  async fixDockerEnvironment(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      debugLog('Starting Docker environment fix...');
      
      // Step 1: Check current status
      const status = await this.checkDockerStatus();
      let fixSteps: string[] = [];
      
      // Step 2: Start container runtime if needed
      if (!status.containerEngineRunning) {
        fixSteps.push('🔄 Starting container runtime...');
        
        if (status.dockerProvider === 'colima') {
          try {
            const { stdout, stderr } = await execAsync('colima start');
            
            if (stderr && !stderr.includes('already running')) {
              return { 
                success: false, 
                message: `Failed to start Colima: ${stderr}`,
                details: { status, error: stderr }
              };
            }
            
            // Wait for Colima to fully start
            await new Promise(resolve => setTimeout(resolve, 3000));
            fixSteps.push('✅ Colima started successfully');
          } catch (error) {
            return { 
              success: false, 
              message: `Failed to start Colima: ${error instanceof Error ? error.message : String(error)}`,
              details: { status, error }
            };
          }
        } else {
          return { 
            success: false, 
            message: 'Docker Desktop is not running. Please start Docker Desktop manually and then run this tool again.',
            details: { status }
          };
        }
      } else {
        fixSteps.push('✅ Container runtime already running');
      }
      
      // Step 3: Verify Docker is accessible
      const updatedStatus = await this.checkDockerStatus();
      if (!updatedStatus.dockerRunning) {
        return { 
          success: false, 
          message: 'Docker is still not accessible after starting container runtime',
          details: { originalStatus: status, updatedStatus }
        };
      }
      
      // Step 4: Initialize secure execution
      fixSteps.push('🔄 Initializing secure execution environment...');
      
      this.containerManager = new ContainerManager();
      await this.containerManager.initialize();
      
      const poolStatus = this.containerManager.getPoolStatus();
      fixSteps.push(`✅ Container pool initialized (${poolStatus.warm} warm containers)`);
      
      // Success!
      const message = [
        '🎉 Docker environment fixed successfully!',
        '',
        '📋 Steps completed:',
        ...fixSteps.map(step => `   ${step}`),
        '',
        '🚀 You can now use task_worker and other secure execution tools'
      ].join('\n');
      
      return { 
        success: true, 
        message,
        details: {
          status: updatedStatus,
          poolStatus,
          provider: updatedStatus.dockerProvider
        }
      };
      
    } catch (error) {
      return { 
        success: false, 
        message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: error instanceof Error ? error.stack : String(error) }
      };
    }
  }

  /**
   * Check Docker/container runtime status
   */
  async checkDockerStatus(): Promise<DockerStatus> {
    const status: DockerStatus = {
      dockerAvailable: false,
      dockerRunning: false,
      dockerProvider: 'unknown',
      containerEngineRunning: false,
      secureExecutionAvailable: false,
      errors: [],
      suggestions: []
    };

    try {
      // Check if Docker CLI is available
      try {
        await execAsync('docker --version');
        status.dockerAvailable = true;
      } catch (error) {
        status.errors.push('Docker CLI not found');
        status.suggestions.push('Install Docker Desktop or Docker CLI');
      }

      // Check if we're using Colima
      const isColima = process.env.DOCKER_HOST?.includes('colima') || 
                      (process.env.HOME && existsSync(`${process.env.HOME}/.colima/default/docker.sock`));
      
      if (isColima) {
        status.dockerProvider = 'colima';
        
        // Check Colima status
        try {
          // Colima outputs to stderr, so capture both stdout and stderr
          const { stdout, stderr } = await execAsync('colima status 2>&1');
          const output = stdout || stderr;
          status.colimaStatus = output.trim();
          
          // Check if Colima is running by looking for "colima is running" in the output
          if (output.includes('colima is running')) {
            status.containerEngineRunning = true;
          } else {
            status.errors.push('Colima is not running');
            status.suggestions.push('Start Colima with: colima start');
          }
        } catch (error) {
          status.errors.push('Colima not found or not accessible');
          status.suggestions.push('Install Colima: brew install colima');
        }
      } else {
        // Check for Docker Desktop or native Docker
        try {
          const { stdout } = await execAsync('docker info --format "{{.ServerVersion}}"');
          if (stdout.trim()) {
            status.dockerProvider = 'docker-desktop';
            status.containerEngineRunning = true;
          }
        } catch (error) {
          status.errors.push('Docker daemon not running');
          status.suggestions.push('Start Docker Desktop or Docker daemon');
        }
      }

      // Try to connect to Docker API
      if (status.containerEngineRunning) {
        try {
          const dockerSocketPath = process.env.DOCKER_HOST || 
            (process.env.HOME && existsSync(`${process.env.HOME}/.colima/default/docker.sock`) 
              ? `unix://${process.env.HOME}/.colima/default/docker.sock`
              : undefined);
          
          this.docker = dockerSocketPath 
            ? new Docker({ socketPath: dockerSocketPath.replace('unix://', '') })
            : new Docker();
          
          await this.docker.ping();
          status.dockerRunning = true;
        } catch (error) {
          status.errors.push('Cannot connect to Docker daemon');
          status.suggestions.push('Check Docker permissions and socket access');
        }
      }

      // Check if secure execution can be initialized
      if (status.dockerRunning) {
        try {
          this.containerManager = new ContainerManager();
          // Don't actually initialize - just check if we can create the manager
          status.secureExecutionAvailable = true;
        } catch (error) {
          status.errors.push('Cannot initialize container manager');
          status.suggestions.push('Check Docker installation and permissions');
        }
      }

    } catch (error) {
      status.errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return status;
  }

  /**
   * Start container runtime (Colima or Docker)
   */
  async startContainerRuntime(): Promise<{ success: boolean; message: string }> {
    try {
      const status = await this.checkDockerStatus();
      
      if (status.containerEngineRunning) {
        return { 
          success: true, 
          message: `Container runtime (${status.dockerProvider}) is already running` 
        };
      }

      if (status.dockerProvider === 'colima') {
        debugLog('Starting Colima...');
        try {
          const { stdout, stderr } = await execAsync('colima start');
          
          if (stderr && !stderr.includes('already running')) {
            return { success: false, message: `Failed to start Colima: ${stderr}` };
          }
          
          // Wait a moment for Colima to fully start
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Verify it's running
          const newStatus = await this.checkDockerStatus();
          if (newStatus.containerEngineRunning) {
            return { success: true, message: 'Colima started successfully' };
          } else {
            return { success: false, message: 'Colima started but Docker is not accessible' };
          }
        } catch (error) {
          return { 
            success: false, 
            message: `Failed to start Colima: ${error instanceof Error ? error.message : String(error)}` 
          };
        }
      } else {
        return { 
          success: false, 
          message: 'Please start Docker Desktop manually or use Colima' 
        };
      }
    } catch (error) {
      return { 
        success: false, 
        message: `Error: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Initialize secure execution environment
   */
  async initializeSecureExecution(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // First check Docker status
      const status = await this.checkDockerStatus();
      
      if (!status.dockerRunning) {
        return { 
          success: false, 
          message: 'Docker is not running. Please start Docker first.',
          details: status 
        };
      }

      // Try to initialize container manager
      this.containerManager = new ContainerManager();
      await this.containerManager.initialize();
      
      return { 
        success: true, 
        message: 'Secure execution environment initialized successfully',
        details: {
          poolStatus: this.containerManager.getPoolStatus()
        }
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: error instanceof Error ? error.stack : String(error) }
      };
    }
  }

  /**
   * Get container pool status
   */
  async getContainerPoolStatus(): Promise<any> {
    if (!this.containerManager) {
      throw new McpError(ErrorCode.InternalError, 'Container manager not initialized');
    }
    
    return this.containerManager.getPoolStatus();
  }

  /**
   * Build Docker image if needed
   */
  async buildDockerImage(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.docker) {
        const status = await this.checkDockerStatus();
        if (!status.dockerRunning) {
          return { success: false, message: 'Docker is not running' };
        }
      }

      // Check if image exists
      const images = await this.docker!.listImages();
      const imageName = 'claude-execution-anthropic:latest';
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.includes(imageName)
      );

      if (imageExists) {
        return { success: true, message: 'Docker image already exists' };
      }

      // Build the image
      debugLog('Building Docker image...');
      // The actual build will be handled by ContainerManager
      // We just check if it's possible here
      
      return { 
        success: true, 
        message: 'Docker image needs to be built. Run secure execution to build it automatically.' 
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Error: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }
}

// Export singleton instance
export const dockerEnvironmentTools = new DockerEnvironmentTools();