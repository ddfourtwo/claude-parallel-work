/**
 * Claude Code Git-Integrated Execution
 * 
 * Replaces the worktree-based secure execution with Git-inside-container approach
 * for simpler, more reliable diff management.
 */

import Docker from 'dockerode';
import { ContainerManager, type Container, type ExecutionResult, type ContainerConfig } from '../docker/containerManager.js';
import { GitDiffIntegration } from './git-diff-integration.js';
import { GitDiff, ContainerSession, RevisionRequest, RevisionResult } from '../types/git-diff-types.js';
import { ClaudeAuthManager } from '../auth/claudeAuthManager.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { debugLog } from './debug.js';
import { existsSync, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PersistenceManager } from '../persistence/database.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ProgressCallback {
  (taskId: string, progress: {
    status: string;
    message: string;
    timestamp: string;
    containerName?: string;
  }): void;
}

export interface GitIntegratedExecutionArgs {
  prompt: string;
  workFolder: string;
  parentTaskId?: string;
  returnMode?: 'summary' | 'full';
  taskDescription?: string;
  speedMode?: 'fast' | 'secure' | 'ultra-secure';
  background?: boolean;
  containerConfig?: {
    memory?: string;
    cpus?: string;
    timeout?: number;
  };
}

export interface GitIntegratedExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number;
  containerId: string;
  diffId?: string;
  taskId?: string; // For background tasks
  status?: 'started' | 'running' | 'completed' | 'failed' | 'needs_input';
  pendingQuestion?: string; // Claude's question when status is 'needs_input'
  sessionId?: string; // Session ID for continuing conversations
  diffSummary?: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  securityInfo: {
    isolated: boolean;
    diffRequired: boolean;
    autoApproved: boolean;
  };
}

export interface BackgroundTask {
  id: string;
  args: GitIntegratedExecutionArgs;
  status: 'started' | 'running' | 'completed' | 'failed' | 'needs_input';
  startTime: Date;
  endTime?: Date;
  containerId?: string;
  dockerContainer?: Docker.Container;
  progress?: string;
  result?: GitIntegratedExecutionResult;
  error?: string;
  sessionId?: string; // For tracking conversation sessions
  pendingQuestion?: string; // Current question waiting for answer
}

/**
 * Manages Git-integrated Claude Code executions
 */
export class GitIntegratedClaudeCodeManager {
  private docker: Docker;
  private containerManager: ContainerManager;
  private gitDiffIntegration: GitDiffIntegration;
  private authManager: ClaudeAuthManager;
  private pendingDiffs: Map<string, GitDiff> = new Map();
  private backgroundTasks: Map<string, BackgroundTask> = new Map();
  private containerSessions: Map<string, ContainerSession> = new Map();
  private progressCallback?: ProgressCallback;
  private sessionCleanupInterval?: NodeJS.Timeout;
  private persistence?: PersistenceManager;

  constructor(progressCallback?: ProgressCallback, persistence?: PersistenceManager) {
    // Initialize Docker
    const dockerSocketPath = process.env.DOCKER_HOST || 
      (process.env.HOME && existsSync(`${process.env.HOME}/.colima/default/docker.sock`) 
        ? `unix://${process.env.HOME}/.colima/default/docker.sock`
        : undefined);
    
    this.docker = dockerSocketPath 
      ? new Docker({ socketPath: dockerSocketPath.replace('unix://', '') })
      : new Docker();
    
    this.containerManager = new ContainerManager();
    this.gitDiffIntegration = new GitDiffIntegration(this.docker, persistence);
    this.authManager = new ClaudeAuthManager();
    this.progressCallback = progressCallback;
    this.persistence = persistence;
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    await this.containerManager.initialize();
    
    // Start session cleanup interval (clean up sessions idle for > 1 hour)
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupIdleSessions();
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    debugLog('Git-integrated Claude Code manager initialized');
  }

  /**
   * Clean up idle sessions
   */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [sessionId, session] of this.containerSessions.entries()) {
      if (session.status === 'hibernated' && 
          now - session.lastActivity.getTime() > oneHour) {
        debugLog(`Cleaning up idle session ${sessionId}`);
        await this.terminateSession(sessionId);
      }
    }
  }

  /**
   * Send progress update
   */
  private sendProgress(taskId: string, status: string, message: string, containerName?: string): void {
    if (this.progressCallback) {
      this.progressCallback(taskId, {
        status,
        message,
        timestamp: new Date().toISOString(),
        containerName
      });
    }
  }

  /**
   * Execute Claude Code with Git-based diff tracking
   */
  async execute(args: GitIntegratedExecutionArgs): Promise<GitIntegratedExecutionResult> {
    // Validate initialization
    const initCheck = await this.validateInitialization();
    if (!initCheck.success) {
      throw new McpError(ErrorCode.InternalError, initCheck.error || 'Manager not initialized');
    }

    // Handle background execution
    if (args.background) {
      return this.executeBackground(args);
    }
    
    // Continue with synchronous execution
    return this.executeSynchronous(args);
  }

  /**
   * Start background execution and return immediately
   */
  private async executeBackground(args: GitIntegratedExecutionArgs): Promise<GitIntegratedExecutionResult> {
    const taskId = args.parentTaskId || `task-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const backgroundTask: BackgroundTask = {
      id: taskId,
      args,
      status: 'started',
      startTime: new Date(),
      progress: 'Initializing background execution...'
    };
    
    this.backgroundTasks.set(taskId, backgroundTask);
    debugLog(`Started background task: ${taskId}`);
    
    // Save to persistence if available
    if (this.persistence) {
      this.persistence.saveBackgroundTask(backgroundTask).catch(error => {
        logger.error('Failed to persist background task', {
          taskId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    
    // Send initial progress update
    this.sendProgress(taskId, 'started', 'Background task initialized');
    
    // Start execution in background (don't await)
    this.runBackgroundExecution(taskId).catch(error => {
      backgroundTask.status = 'failed';
      backgroundTask.error = error.message;
      backgroundTask.endTime = new Date();
      debugLog(`Background task ${taskId} failed:`, error);
    });
    
    // Return immediately with task ID and monitoring instructions
    const monitoringInstructions = `✅ Background execution started (ID: ${taskId})

**Next steps:**
• work_status taskId="${taskId}" - Monitor execution progress
• view_container_logs identifier="${taskId}" - View detailed logs
• answer_worker_question taskId="${taskId}" answer="..." - If Claude asks a question

🔍 **Watch logs live in terminal:**
\`\`\`bash
tail -f ~/mcp-servers/claude-parallel-work/dist/logs/*-${taskId}.log
\`\`\`


💡 Pro tip: Continue with other tasks while this runs in the background`;

    return {
      success: true,
      taskId,
      status: 'started',
      output: monitoringInstructions,
      executionTime: 0,
      containerId: 'background',
      securityInfo: {
        isolated: true,
        diffRequired: false,
        autoApproved: false
      }
    };
  }

  /**
   * Run background execution
   */
  private async runBackgroundExecution(taskId: string): Promise<void> {
    const task = this.backgroundTasks.get(taskId);
    if (!task) {
      throw new Error(`Background task ${taskId} not found`);
    }
    
    try {
      task.status = 'running';
      task.progress = 'Executing in secure container...';
      
      // Send running progress update
      this.sendProgress(taskId, 'running', 'Executing in secure container...');
      
      // Execute synchronously but track progress
      const result = await this.executeSynchronous(task.args, taskId, true);
      
      // Handle different result statuses
      if (result.status === 'needs_input') {
        task.status = 'needs_input';
        task.result = result;
        task.progress = 'Waiting for user input';
        task.sessionId = result.sessionId;
        task.pendingQuestion = result.pendingQuestion;
        
        // Send needs_input progress update
        this.sendProgress(taskId, 'needs_input', 'Claude is asking a question', undefined);
        
        debugLog(`Background task ${taskId} needs input: ${result.pendingQuestion}`);
      } else {
        task.status = 'completed';
        task.result = result;
        task.endTime = new Date();
        task.progress = 'Execution completed successfully';
        
        // Send completion progress update with container name
        const containerName = result.containerId ? `claude-parallel-${taskId}` : undefined;
        this.sendProgress(taskId, 'completed', 'Execution completed successfully', containerName);
        
        debugLog(`Background task ${taskId} completed successfully`);
      }
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();
      task.progress = `Execution failed: ${task.error}`;
      
      // Send failure progress update
      this.sendProgress(taskId, 'failed', `Execution failed: ${task.error}`);
      
      debugLog(`Background task ${taskId} failed:`, error);
      throw error;
    }
  }

  /**
   * Execute synchronously with Git-based diff tracking
   */
  private async executeSynchronous(
    args: GitIntegratedExecutionArgs, 
    taskId?: string, 
    isBackground = false
  ): Promise<GitIntegratedExecutionResult> {
    const startTime = Date.now();
    let dockerContainer: Docker.Container | null = null;
    let containerId: string = '';
    
    // Generate taskId if not provided (for sync tasks)
    const actualTaskId = taskId || `task-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      debugLog(`Starting Git-integrated execution: ${actualTaskId}`);
      
      // Validate workspace
      if (!args.workFolder) {
        throw new McpError(ErrorCode.InvalidParams, 'workFolder is required for secure execution');
      }

      // Determine speed/security mode
      const speedMode = args.speedMode || 'fast';
      
      debugLog(`Execution mode: ${speedMode}`);

      // Create container with read-write workspace mount
      // Git will be initialized inside the container
      const container = await this.containerManager.createReadOnlyContainer(
        args.workFolder,
        args.containerConfig,
        actualTaskId
      );
      
      dockerContainer = container as any; // Type conversion for Docker container
      containerId = dockerContainer?.id || 'unknown';
      debugLog(`Created container ${containerId} with Git tracking`);

      // Store container reference for background tasks
      if (isBackground && actualTaskId) {
        const task = this.backgroundTasks.get(actualTaskId);
        if (task) {
          task.containerId = containerId;
          task.dockerContainer = dockerContainer || undefined;
        }
      }

      // Execute Claude Code in container
      if (!dockerContainer) {
        throw new Error('Docker container not initialized');
      }
      const executionResult = await this.executeClaudeInContainer(
        dockerContainer,
        args.prompt,
        args.taskDescription,
        actualTaskId
      );

      if (!executionResult.success) {
        throw new Error(executionResult.error || 'Claude Code execution failed');
      }
      
      // Check if Claude needs input
      if (executionResult.status === 'needs_input') {
        // Store the session for later continuation
        const sessionId = executionResult.sessionId || `session-${actualTaskId}`;
        const session: ContainerSession = {
          sessionId,
          containerId,
          workspaceState: args.workFolder,
          originalPrompt: args.prompt,
          lastPrompt: args.prompt,
          revisionCount: 0,
          status: 'active',
          taskId: actualTaskId,
          diffId: '', // Will be set when diff is created
          lastActivity: new Date(),
          dockerContainer
        };
        this.containerSessions.set(sessionId, session);
        
        debugLog(`Claude needs input for task ${actualTaskId}, session ${sessionId} created`);
        
        // Return early with needs_input status
        const executionTime = Date.now() - startTime;
        const result: GitIntegratedExecutionResult = {
          success: true,
          output: executionResult.output,
          executionTime,
          containerId,
          taskId: actualTaskId,
          status: 'needs_input',
          pendingQuestion: executionResult.pendingQuestion,
          sessionId,
          securityInfo: {
            isolated: true,
            diffRequired: false,
            autoApproved: false
          }
        };
        
        return result;
      }

      // Extract diff using Git
      if (!dockerContainer) {
        throw new Error('Docker container not initialized');
      }
      const diffResult = await this.gitDiffIntegration.extractAndStoreDiff(
        dockerContainer,
        args.workFolder
      );

      if (!diffResult.success) {
        throw new Error(diffResult.error || 'Failed to extract diff');
      }

      const diff = diffResult.diff!;
      debugLog(`Extracted Git diff: ${diff.id}, ${diff.stats.filesChanged} files changed`);
      
      // Add session and workspace info to diff
      diff.workspace = args.workFolder;
      diff.originalTaskId = actualTaskId;
      if (executionResult.sessionId) {
        diff.sessionId = executionResult.sessionId;
      }

      // Always require approval for changes
      if (diff.stats.filesChanged > 0) {
        // Store diff for manual approval
        this.pendingDiffs.set(diff.id, diff);
        debugLog(`Stored diff ${diff.id} for manual approval`);
        
        // Store container session if we have a session ID
        if (executionResult.sessionId && dockerContainer) {
          const session: ContainerSession = {
            sessionId: executionResult.sessionId,
            containerId,
            workspaceState: args.workFolder,
            originalPrompt: args.prompt,
            lastPrompt: args.prompt,
            revisionCount: 0,
            status: 'active',
            taskId: actualTaskId,
            diffId: diff.id,
            lastActivity: new Date(),
            dockerContainer
          };
          this.containerSessions.set(executionResult.sessionId, session);
          debugLog(`Stored container session ${executionResult.sessionId} for future revisions`);
        }
      }

      // Stop container (unless debug mode prevents cleanup)
      if (dockerContainer && process.env.CLAUDE_PARALLEL_DEBUG_NO_CLEANUP !== 'true') {
        await dockerContainer.stop().catch(() => {});
        debugLog('Container stopped');
      } else if (process.env.CLAUDE_PARALLEL_DEBUG_NO_CLEANUP === 'true') {
        debugLog(`Container ${containerId} kept running for debugging (CLAUDE_PARALLEL_DEBUG_NO_CLEANUP=true)`);
      }

      const executionTime = Date.now() - startTime;

      const result: GitIntegratedExecutionResult = {
        success: true,
        output: this.formatOutput(executionResult.output || '', args, diff),
        executionTime,
        containerId,
        taskId: actualTaskId,
        diffId: diff.stats.filesChanged > 0 ? diff.id : undefined,
        diffSummary: diff.stats.filesChanged > 0 ? {
          filesChanged: diff.stats.filesChanged,
          additions: diff.stats.additions,
          deletions: diff.stats.deletions
        } : undefined,
        securityInfo: {
          isolated: true,
          diffRequired: diff.stats.filesChanged > 0,
          autoApproved: false
        }
      };

      debugLog(`Git-integrated execution completed: ${actualTaskId}, ${executionTime}ms`);
      return result;

    } catch (error) {
      // Log the error visibly
      console.error(`[GitIntegrated] Execution failed for task ${actualTaskId}:`, error);
      
      // Cleanup on error (unless debug mode prevents cleanup)
      if (dockerContainer && process.env.CLAUDE_PARALLEL_DEBUG_NO_CLEANUP !== 'true') {
        await dockerContainer.stop().catch(() => {});
        debugLog('Container stopped on error');
      } else if (process.env.CLAUDE_PARALLEL_DEBUG_NO_CLEANUP === 'true') {
        debugLog(`Container kept running for debugging on error (CLAUDE_PARALLEL_DEBUG_NO_CLEANUP=true)`);
      }
      
      const executionTime = Date.now() - startTime;
      debugLog(`Git-integrated execution failed: ${actualTaskId}, ${executionTime}ms, error: ${error}`);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        containerId: containerId || 'unknown',
        taskId: actualTaskId,
        securityInfo: {
          isolated: true,
          diffRequired: false,
          autoApproved: false
        }
      };
    }
  }

  /**
   * Build a contextual prompt with clear instructions for Claude
   */
  private buildContextualPrompt(prompt: string, taskDescription?: string): string {
    const sections: string[] = [];
    
    // Add header with context
    sections.push('# Claude Code Execution Context');
    sections.push('');
    sections.push('You are Claude Code running in a containerized environment with the following context:');
    sections.push('- **Working Directory**: /workspace (contains the project files)');
    sections.push('- **Environment**: Isolated Docker container with full development tools');
    sections.push('- **Available Tools**: You have access to file operations (Read, Write, Edit), Bash commands, and Git operations');
    sections.push('');
    
    // Add task description if provided
    if (taskDescription) {
      sections.push('## Task Description');
      sections.push(taskDescription);
      sections.push('');
    }
    
    // Add specific instructions
    sections.push('## Instructions');
    sections.push(prompt);
    sections.push('');
    
    // Add execution guidance
    sections.push('## Execution Guidelines');
    sections.push('1. You are in the /workspace directory which contains the project files');
    sections.push('2. Use the available tools to complete the task');
    sections.push('3. Be direct and execute the requested task immediately');
    sections.push('4. If the task is unclear, ask a specific clarifying question');
    sections.push('5. Focus on completing the specific task requested');
    
    return sections.join('\n');
  }

  /**
   * Execute Claude Code inside container
   */
  private async executeClaudeInContainer(
    container: Docker.Container,
    prompt: string,
    taskDescription?: string,
    taskId?: string
  ): Promise<{ 
    success: boolean; 
    output?: string; 
    error?: string; 
    status?: 'needs_input'; 
    pendingQuestion?: string; 
    sessionId?: string;
  }> {
    try {
      // Create log file for this execution - include both container ID and task ID
      const containerShortId = container.id.substring(0, 12);
      const logFileName = taskId ? `${containerShortId}-${taskId}.log` : `${containerShortId}.log`;
      // Use __dirname to get the directory of this file, then navigate to logs
      const logsDir = path.join(__dirname, '..', 'logs');
      const logPath = path.join(logsDir, logFileName);
      
      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });
      
      // Create write stream for logging
      const logStream = createWriteStream(logPath, { flags: 'a' });
      
      // Write header
      const timestamp = new Date().toISOString();
      logStream.write(`=== Claude Code Execution Log ===\n`);
      logStream.write(`Task ID: ${taskId || 'sync'}\n`);
      logStream.write(`Container: ${container.id}\n`);
      logStream.write(`Log File: ${logFileName}\n`);
      logStream.write(`Started: ${timestamp}\n`);
      logStream.write(`Task Description: ${taskDescription || 'None'}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);
      
      // Build a comprehensive prompt with context and instructions
      const contextualPrompt = this.buildContextualPrompt(prompt, taskDescription);
      const escapedPrompt = contextualPrompt.replace(/'/g, "'\"'\"'"); // Shell escape single quotes
      
      // Comprehensive list of allowed tools for Claude to use
      const allowedTools = [
        "Edit",
        "Read", 
        "Create",
        "Write",
        "MultiEdit",
        "Search",
        "Update",
        "Task",
        "Delete",
        "Bash(npm:*)",
        "Bash(yarn:*)",
        "Bash(pnpm:*)",
        "Bash(ls:*)",
        "Bash(find:*)",
        "Bash(grep:*)",
        "Bash(cat:*)",
        "Bash(git add:*)",
        "Bash(git status:*)",
        "Bash(git diff:*)",
        "Bash(git checkout:*)",
        "Bash(git branch:*)",
        "Bash(git fetch:*)",
        "Bash(git commit:*)",
        "Bash(git push:*)",
        "Git(git add:*)",
        "Git(git status)",
        "Git(git diff:*)",
        "Git(git checkout:*)",
        "Git(git branch:*)",
        "Git(git fetch:*)",
        "Git(git commit:*)", 
        "Git(git push:*)"
      ].join(",");
      
      // Run claude directly for now (tmux integration needs more work)
      const command = `claude -p '${escapedPrompt}' --allowedTools "${allowedTools}"`;
      
      // Log the command for debugging
      logStream.write(`Command: ${command}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);
      
      const exec = await container.exec({
        Cmd: ['bash', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        User: 'node',
        WorkingDir: '/workspace'
      });

      const stream = await exec.start({ hijack: true });
      
      return new Promise((resolve) => {
        let output = '';
        let error = '';
        const startTime = Date.now();

        // Add heartbeat to show container is still working (every 30 seconds)
        const heartbeatInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const logTimestamp = new Date().toISOString();
          logStream.write(`[${logTimestamp}] [HEARTBEAT] Task still executing... (${elapsed}s elapsed)\n`);
        }, 30000); // 30 seconds

        stream.on('data', (chunk: Buffer) => {
          const str = chunk.toString();
          const logTimestamp = new Date().toISOString();
          
          if (chunk[0] === 1) {
            const content = str.substring(8);
            output += content;
            logStream.write(`[${logTimestamp}] [STDOUT] ${content}`);
          } else if (chunk[0] === 2) {
            const content = str.substring(8);
            error += content;
            logStream.write(`[${logTimestamp}] [STDERR] ${content}`);
          } else {
            output += str;
            logStream.write(`[${logTimestamp}] [OUTPUT] ${str}`);
          }
        });

        stream.on('end', () => {
          // Clear heartbeat interval
          clearInterval(heartbeatInterval);
          
          // Write footer
          const endTimestamp = new Date().toISOString();
          const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
          logStream.write(`\n${'='.repeat(50)}\n`);
          logStream.write(`Completed: ${endTimestamp}\n`);
          logStream.write(`Total Duration: ${totalElapsed}s\n`);
          
          // Check if Claude is asking a question instead of executing
          const isQuestion = output.includes('?') && !output.includes('```') && output.length < 500;
          
          if (isQuestion) {
            logStream.write(`Question detected - Claude needs input\n`);
            logStream.write(`Status: needs_input\n`);
            logStream.write(`Question: ${output.trim()}\n`);
            logStream.end();
            
            debugLog(`Claude asked a question: ${output}`);
            
            // Generate session ID for conversation tracking
            const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            resolve({ 
              success: true,
              output,
              status: 'needs_input',
              pendingQuestion: output.trim(),
              sessionId
            });
          } else {
            logStream.write(`Success: ${error && !output ? 'false' : 'true'}\n`);
            logStream.end();
            
            debugLog(`Execution logs saved to: ${logPath}`);
            
            if (error && !output) {
              resolve({ success: false, error });
            } else {
              resolve({ success: true, output });
            }
          }
        });

        stream.on('error', (err) => {
          // Clear heartbeat interval on error
          clearInterval(heartbeatInterval);
          
          logStream.write(`\nERROR: ${err.message}\n`);
          logStream.end();
          resolve({ success: false, error: err.message });
        });
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Answer Claude's question in an existing container session
   */
  async answerClaudeQuestion(taskId: string, answer: string): Promise<string> {
    try {
      // Find the background task
      const task = this.backgroundTasks.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }
      
      if (task.status !== 'needs_input') {
        throw new Error(`Task ${taskId} is not waiting for input (status: ${task.status})`);
      }
      
      // Find the container session
      const session = this.containerSessions.get(task.sessionId || '');
      if (!session) {
        throw new Error(`No active session found for task ${taskId}`);
      }
      
      // Store the question before clearing it
      const previousQuestion = task.pendingQuestion;
      
      // Update task status
      task.status = 'running';
      task.progress = 'Processing your answer...';
      this.sendProgress(taskId, 'running', 'Processing your answer...');
      
      // Start the answer process in background
      this.processAnswerInBackground(taskId, answer, session, task, previousQuestion);
      
      return `Answer submitted for task ${taskId}\n\n📊 Monitor progress: work_status with taskId "${taskId}"\n\n🔍 View logs: view_container_logs identifier="${taskId}"`;
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Process the answer in background (async)
   */
  private async processAnswerInBackground(
    taskId: string, 
    answer: string, 
    session: { taskId: string; containerId: string; dockerContainer: Docker.Container; sessionId: string; lastActivity: Date },
    task: BackgroundTask,
    previousQuestion?: string
  ): Promise<void> {
    try {
      // Execute Claude with the answer as a follow-up
      const followUpPrompt = `Previous question: ${previousQuestion}\n\nAnswer: ${answer}\n\nNow please proceed with the original task.`;
      
      const executionResult = await this.executeClaudeInContainer(
        session.dockerContainer,
        followUpPrompt,
        task.args.taskDescription,
        taskId
      );
      
      // Update session activity
      session.lastActivity = new Date();
      
      // Handle the result
      if (executionResult.status === 'needs_input') {
        // Claude asked another question
        task.status = 'needs_input';
        task.pendingQuestion = executionResult.pendingQuestion;
        task.progress = 'Waiting for additional input';
        
        this.sendProgress(taskId, 'needs_input', 'Claude has another question', undefined);
        
      } else {
        // Task completed, extract diff
        const diffResult = await this.gitDiffIntegration.extractAndStoreDiff(
          session.dockerContainer,
          task.args.workFolder
        );
        
        if (!diffResult.success) {
          throw new Error(diffResult.error || 'Failed to extract diff');
        }
        
        const diff = diffResult.diff!;
        
        // Clean up session
        this.containerSessions.delete(task.sessionId || '');
        await session.dockerContainer.stop().catch(() => {});
        
        // Update task
        task.status = 'completed';
        task.endTime = new Date();
        task.progress = 'Task completed successfully';
        
        const result: GitIntegratedExecutionResult = {
          success: true,
          output: executionResult.output,
          executionTime: task.endTime.getTime() - task.startTime.getTime(),
          containerId: session.containerId,
          diffId: diff.stats.filesChanged > 0 ? diff.id : undefined,
          status: 'completed',
          diffSummary: diff.stats.filesChanged > 0 ? {
            filesChanged: diff.stats.filesChanged,
            additions: diff.stats.additions,
            deletions: diff.stats.deletions
          } : undefined,
          securityInfo: {
            isolated: true,
            diffRequired: true,
            autoApproved: false
          }
        };
        
        task.result = result;
        this.sendProgress(taskId, 'completed', 'Task completed successfully');
      }
    } catch (error) {
      // Update task on error
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();
      this.sendProgress(taskId, 'failed', `Failed: ${task.error}`);
      
      debugLog(`Background answer processing failed for task ${taskId}:`, error);
    }
  }

  /**
   * Validate manager initialization
   */
  private async validateInitialization(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.containerManager) {
        return { success: false, error: 'Container manager not initialized' };
      }
      if (!this.gitDiffIntegration) {
        return { success: false, error: 'Git diff integration not initialized' };
      }
      if (!this.authManager) {
        return { success: false, error: 'Auth manager not initialized' };
      }
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Validation failed' 
      };
    }
  }


  /**
   * Format output for display
   */
  private formatOutput(
    claudeOutput: string, 
    args: GitIntegratedExecutionArgs, 
    diff: GitDiff
  ): string {
    const parts: string[] = [];

    // Add Claude output
    if (claudeOutput.trim()) {
      parts.push(claudeOutput.trim());
    }

    // Add diff summary if changes were made
    if (diff.stats.filesChanged > 0) {
      parts.push('\n## Changes Summary');
      parts.push(`Files changed: ${diff.stats.filesChanged}`);
      parts.push(`Additions: ${diff.stats.additions} lines`);
      parts.push(`Deletions: ${diff.stats.deletions} lines`);
      
      if (this.pendingDiffs.has(diff.id)) {
        parts.push('\n✋ Manual approval required');
        parts.push('\n**Next steps:**');
        parts.push(`• review_changes diffId="${diff.id}" - Review all modifications`);
        parts.push(`• apply_changes diffId="${diff.id}" targetWorkspace="${args.workFolder}" - Apply to project`);
        parts.push(`• request_revision diffId="${diff.id}" feedback="..." - Request specific changes`);
        parts.push(`• reject_changes diffId="${diff.id}" - Permanently discard changes`);
      }
    } else {
      // No changes made
      parts.push('\n**Next steps:**');
      parts.push(`• task_worker task="next task" workFolder="${args.workFolder}" - Continue development`);
      parts.push(`• get_next_tasks workFolder="${args.workFolder}" - Find more tasks`);
    }

    // Format based on return mode
    if (args.returnMode === 'summary') {
      return parts.join('\n').substring(0, 500) + '...';
    }

    return parts.join('\n');
  }

  /**
   * List pending diffs awaiting approval
   */
  listPendingDiffs(): GitDiff[] {
    return Array.from(this.pendingDiffs.values());
  }

  /**
   * Get details of a specific diff
   */
  async getDiff(diffId: string): Promise<GitDiff | null> {
    return this.pendingDiffs.get(diffId) || 
           await this.gitDiffIntegration.getDiff(diffId) || 
           null;
  }

  /**
   * Apply a pending diff
   */
  async applyDiff(diffId: string, targetWorkspace: string): Promise<void> {
    const diff = await this.getDiff(diffId);
    if (!diff) {
      throw new McpError(ErrorCode.InvalidParams, `Diff not found: ${diffId}`);
    }

    const result = await this.gitDiffIntegration.applyDiff(diffId, targetWorkspace);
    if (!result.success) {
      throw new Error(result.error || 'Failed to apply diff');
    }
    
    // Remove from pending
    this.pendingDiffs.delete(diffId);
    debugLog(`Applied diff ${diffId} to ${targetWorkspace}`);
  }

  /**
   * Reject a pending diff
   */
  async rejectDiff(diffId: string): Promise<void> {
    const diff = this.pendingDiffs.get(diffId);
    if (!diff) {
      throw new McpError(ErrorCode.InvalidParams, `Diff not found: ${diffId}`);
    }

    // Clean up any associated session
    const session = this.findSessionByDiffId(diffId);
    if (session) {
      await this.terminateSession(session.sessionId);
    }

    this.pendingDiffs.delete(diffId);
    debugLog(`Rejected diff ${diffId}`);
  }

  /**
   * Request a revision to existing changes
   */
  async requestRevision(request: RevisionRequest): Promise<RevisionResult> {
    const { diffId, feedback, preserveCorrectParts = true, additionalContext } = request;
    
    // Get the original diff
    const originalDiff = await this.getDiff(diffId);
    if (!originalDiff) {
      return {
        success: false,
        error: `Diff not found: ${diffId}`
      };
    }

    // Find or restore the container session
    let session = this.findSessionByDiffId(diffId);
    if (!session && originalDiff.sessionId) {
      // Try to restore from stored session info
      session = await this.restoreSession(originalDiff);
    }

    if (!session) {
      return {
        success: false,
        error: 'Cannot restore container session for revision'
      };
    }

    try {
      // Update revision count
      const revisionCount = (originalDiff.revisionHistory?.length || 0) + 1;
      
      // Build revision prompt
      const revisionPrompt = this.buildRevisionPrompt({
        originalPrompt: session.originalPrompt,
        lastPrompt: session.lastPrompt,
        feedback,
        preserveCorrectParts,
        additionalContext,
        currentFiles: originalDiff.files
      });

      // Execute revision in the same container
      const taskId = `revision-${diffId}-${revisionCount}`;
      const result = await this.executeRevisionInContainer({
        session,
        prompt: revisionPrompt,
        taskId,
        originalDiff,
        revisionCount
      });

      if (result.success && result.diffId) {
        // Update the new diff with revision info
        const newDiff = await this.getDiff(result.diffId);
        if (newDiff) {
          newDiff.isRevision = true;
          newDiff.parentDiffId = diffId;
          newDiff.sessionId = session.sessionId;
          newDiff.originalTaskId = originalDiff.originalTaskId || diffId;
          
          // Update revision history
          if (!originalDiff.revisionHistory) {
            originalDiff.revisionHistory = [];
          }
          originalDiff.revisionHistory.push({
            timestamp: new Date(),
            feedback,
            diffId: result.diffId,
            revisionNumber: revisionCount
          });
        }
      }

      return {
        success: result.success,
        newDiffId: result.diffId,
        taskId: result.taskId,
        error: result.error,
        revisionCount
      };
      
    } catch (error) {
      debugLog('Revision request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Find session by diff ID
   */
  private findSessionByDiffId(diffId: string): ContainerSession | undefined {
    for (const session of this.containerSessions.values()) {
      if (session.diffId === diffId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Build revision prompt
   */
  private buildRevisionPrompt(args: {
    originalPrompt: string;
    lastPrompt: string;
    feedback: string;
    preserveCorrectParts: boolean;
    additionalContext?: string;
    currentFiles: any[];
  }): string {
    const { originalPrompt, feedback, preserveCorrectParts, additionalContext, currentFiles } = args;
    
    return `You previously worked on this task:
${originalPrompt}

Your implementation has been reviewed with the following feedback:
${feedback}

${additionalContext ? `Additional context:\n${additionalContext}\n\n` : ''}Please revise your implementation to address this feedback${preserveCorrectParts ? ' while preserving the parts that are working correctly' : ''}.

Current files modified:
${currentFiles.map(f => `- ${f.path} (${f.status})`).join('\n')}

Focus on addressing the specific feedback provided. Make the necessary changes to improve the implementation.`;
  }

  /**
   * Execute revision in existing container
   */
  private async executeRevisionInContainer(args: {
    session: ContainerSession;
    prompt: string;
    taskId: string;
    originalDiff: GitDiff;
    revisionCount: number;
  }): Promise<GitIntegratedExecutionResult> {
    const { session, prompt, taskId, originalDiff, revisionCount } = args;
    
    // Create a background task for the revision
    const backgroundTask: BackgroundTask = {
      id: taskId,
      args: {
        prompt,
        workFolder: originalDiff.workspace || session.workspaceState,
        parentTaskId: taskId,
        taskDescription: `Revision ${revisionCount} for ${originalDiff.id}`,
        background: true
      },
      status: 'started',
      startTime: new Date(),
      sessionId: session.sessionId,
      containerId: session.containerId
    };
    
    this.backgroundTasks.set(taskId, backgroundTask);
    
    // Start revision execution
    this.runBackgroundExecution(taskId).catch(error => {
      backgroundTask.status = 'failed';
      backgroundTask.error = error.message;
      debugLog(`Revision execution ${taskId} failed:`, error);
    });
    
    return {
      success: true,
      taskId,
      status: 'started',
      output: `Revision started (ID: ${taskId})\n\nMonitor with: work_status taskId="${taskId}"`,
      executionTime: 0,
      containerId: session.containerId,
      securityInfo: {
        isolated: true,
        diffRequired: true,
        autoApproved: false
      }
    };
  }

  /**
   * Restore a container session
   */
  private async restoreSession(diff: GitDiff): Promise<ContainerSession | undefined> {
    // For now, we'll create a new session since full hibernation is complex
    // In the future, this could restore from a hibernated container
    debugLog(`Session restoration not yet implemented for diff ${diff.id}`);
    return undefined;
  }

  /**
   * Terminate a container session
   */
  private async terminateSession(sessionId: string): Promise<void> {
    const session = this.containerSessions.get(sessionId);
    if (!session) return;
    
    try {
      // Stop the container if it exists
      const container = this.docker.getContainer(session.containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove().catch(() => {});
    } catch (error) {
      debugLog(`Error terminating session ${sessionId}:`, error);
    }
    
    this.containerSessions.delete(sessionId);
  }

  /**
   * Get background task status
   */
  async getBackgroundTaskStatus(taskId?: string): Promise<BackgroundTask | BackgroundTask[] | undefined> {
    if (taskId) {
      // Check memory first
      let task = this.backgroundTasks.get(taskId);
      
      // If not in memory and we have persistence, check database
      if (!task && this.persistence) {
        try {
          task = await this.persistence.getBackgroundTask(taskId);
          if (task) {
            // Add back to memory cache
            this.backgroundTasks.set(taskId, task);
          }
        } catch (error) {
          logger.error('Failed to retrieve task from persistence', {
            taskId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      return task || undefined;
    }
    return Array.from(this.backgroundTasks.values());
  }

  /**
   * Get system status for health checks
   */
  async getStatus(): Promise<{
    containerPool: any;
    pendingDiffs: number;
    authStatus: any;
    backgroundTasks: {
      total: number;
      running: number;
      completed: number;
      failed: number;
      tasks: BackgroundTask[];
    };
  }> {
    const poolStatus = this.containerManager.getPoolStatus();
    const authStatus = await this.authManager.getAuthStatus();
    
    const backgroundTaskStats = {
      total: this.backgroundTasks.size,
      running: 0,
      completed: 0,
      failed: 0,
      tasks: Array.from(this.backgroundTasks.values())
    };

    backgroundTaskStats.tasks.forEach(task => {
      switch (task.status) {
        case 'running':
        case 'started':
          backgroundTaskStats.running++;
          break;
        case 'completed':
          backgroundTaskStats.completed++;
          break;
        case 'failed':
          backgroundTaskStats.failed++;
          break;
      }
    });

    return {
      containerPool: poolStatus,
      pendingDiffs: this.pendingDiffs.size,
      authStatus,
      backgroundTasks: backgroundTaskStats
    };
  }

  /**
   * Format diff for review
   */
  async formatDiffForReview(diffId: string): Promise<string | null> {
    const diff = await this.getDiff(diffId);
    if (!diff) {
      return null;
    }
    return this.gitDiffIntegration.formatDiffForReview(diff);
  }

  /**
   * Cleanup old background tasks
   */
  async cleanup(olderThanHours: number = 24): Promise<void> {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    const toDelete: string[] = [];

    this.backgroundTasks.forEach((task, id) => {
      if (task.endTime && task.endTime.getTime() < cutoff) {
        toDelete.push(id);
      }
    });

    for (const id of toDelete) {
      this.backgroundTasks.delete(id);
    }

    // Also cleanup old diffs
    await this.gitDiffIntegration.cleanup(olderThanHours);
    
    debugLog(`Cleaned up ${toDelete.length} old background tasks`);
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    await this.containerManager.shutdown();
    debugLog('Git-integrated Claude Code manager shut down');
  }
}