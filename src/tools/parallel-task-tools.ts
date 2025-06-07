/**
 * Simplified Parallel Task Orchestration Tools
 * 
 * Uses file-based storage (tasks.json) instead of in-memory Maps
 * Extracts tasks.json from containers using git diff
 */

import { GitIntegratedClaudeCodeManager } from './claude-code-git-integrated.js';
import { SimpleTasksManager } from './simple-tasks-manager.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';

// Debug logging function
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';
function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error('[SimplifiedTaskTools]', message, ...optionalParams);
  }
}

export interface ProjectTaskBreakdownArgs {
  taskDescription: string;
  workFolder: string;
  scope?: 'small' | 'medium' | 'large' | 'enterprise';
  prioritizeSpeed?: boolean;
  allowParallel?: boolean;
  context?: string;
  background?: boolean; // Whether to run in background mode (default: false for synchronous)
}

export interface TaskStatusArgs {
  workFolder: string;
  showDetails?: boolean;
}

/**
 * Simplified task orchestration that always persists to files
 */
export class ParallelTaskOrchestrationTools {
  private secureManager: GitIntegratedClaudeCodeManager;

  constructor(secureManager: GitIntegratedClaudeCodeManager) {
    this.secureManager = secureManager;
  }

  /**
   * Break down a project into tasks and save to tasks.json
   */
  async breakdownProject(args: ProjectTaskBreakdownArgs): Promise<string> {
    try {
      const { 
        taskDescription, 
        workFolder, 
        scope = 'medium', 
        prioritizeSpeed = true, 
        allowParallel = true,
        context 
      } = args;

      debugLog('Starting task breakdown:', taskDescription);

      // Create the prompt for AI task breakdown
      const breakdownPrompt = this.createBreakdownPrompt({
        taskDescription,
        scope,
        prioritizeSpeed,
        allowParallel,
        context
      });

      // Execute in background or synchronous mode based on parameter
      const background = args.background ?? false; // Default to synchronous mode
      
      const result = await this.secureManager.execute({
        prompt: breakdownPrompt,
        workFolder,
        taskDescription: `Task breakdown: ${taskDescription}`,
        speedMode: 'fast',
        returnMode: 'full',
        background // Use the background parameter
      });

      if (!result.success) {
        throw new Error(`Task breakdown failed: ${result.error}`);
      }

      if (background) {
        // Background mode: return monitoring info immediately
        const taskId = result.taskId;
        if (!taskId) {
          throw new Error('No task ID returned from background execution');
        }

        // Container name follows the pattern: claude-parallel-${taskId}
        const containerName = `claude-parallel-${taskId}`;
        
        return `✅ Task breakdown started (ID: ${taskId})
**Workspace:** ${workFolder}
**Log stream:** tail -f ~/mcp-servers/claude-parallel-work/dist/logs/*-${taskId}.log

**Next steps:**
• work_status taskId="${taskId}" - Monitor breakdown progress
• view_container_logs identifier="${taskId}" - View detailed logs
• review_changes - Review generated tasks.json once complete
• apply_changes diffId="..." targetWorkspace="${workFolder}" - Apply tasks.json to project

💡 Pro tip: Once applied, use get_next_tasks to start parallel execution`;
      } else {
        // Synchronous mode: wait for completion and return full results
        if (!result.success) {
          throw new Error(`Task breakdown failed: ${result.error}`);
        }

        // Extract diff information from the result
        const diffId = result.diffId;
        const taskId = result.taskId;
        const containerName = taskId ? `claude-parallel-${taskId}` : undefined;
        const diffSummary = result.diffSummary || { filesChanged: 0, additions: 0, deletions: 0 };
        const executionTime = result.executionTime ? `${Math.round(result.executionTime / 1000)}s` : 'unknown';
        
        return `✅ Task breakdown completed successfully!
**Workspace:** ${workFolder}
**Task ID:** ${taskId || 'unknown'}
**Container:** ${containerName || 'unknown'}
**Execution time:** ${executionTime}
**Changes:** ${diffSummary.filesChanged} files modified (+${diffSummary.additions} -${diffSummary.deletions})
${diffId ? `**Diff ID:** ${diffId}` : ''}

**Next steps:**
• review_changes${diffId ? ` diffId="${diffId}"` : ''} - Review the generated tasks.json
• apply_changes${diffId ? ` diffId="${diffId}"` : ''} targetWorkspace="${workFolder}" - Apply tasks.json to your project
• get_next_tasks workFolder="${workFolder}" - Find ready tasks after applying
• view_container_logs identifier="${taskId}" - View detailed execution logs

💡 Pro tip: The tasks.json file has been generated and is ready for review`;
      }

    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Task breakdown failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get status of tasks from tasks.json
   */
  async getTaskStatus(args: TaskStatusArgs): Promise<string> {
    try {
      const { workFolder, showDetails = false } = args;

      const simpleTasksManager = new SimpleTasksManager(workFolder);
      const tasksFile = await simpleTasksManager.read();

      if (!tasksFile) {
        return `No tasks.json file found in ${workFolder}

**Next steps:**
• get_tasks workFolder="${workFolder}" - View tasks if they exist elsewhere`;
      }

      const summary = await simpleTasksManager.getSummary();
      
      let statusReport = `## Task Status for ${path.basename(workFolder)}

**Total Tasks**: ${summary.total}
**Completed**: ${summary.done} ✅
**In Progress**: ${summary.inProgress} 🔄
**Pending**: ${summary.pending} ⏳
**Blocked**: ${summary.blocked} 🚫
**Failed**: ${summary.failed} ❌

**Progress**: ${Math.round((summary.done / summary.total) * 100)}%`;

      if (showDetails) {
        statusReport += '\n\n### Task Details:\n';
        for (const task of tasksFile.tasks) {
          const statusEmoji = {
            'done': '✅',
            'in-progress': '🔄',
            'pending': '⏳',
            'failed': '❌'
          }[task.status];
          
          statusReport += `\n${statusEmoji} **Task ${task.id}**: ${task.title}`;
          if (task.dependencies.length > 0) {
            statusReport += ` (depends on: ${task.dependencies.join(', ')})`;
          }
          if (task.containerId) {
            statusReport += `\n   Container: ${task.containerId}`;
          }
          if (task.error) {
            statusReport += `\n   ❌ Error: ${task.error}`;
          }
        }
      }

      // Find next executable task
      const nextTask = await simpleTasksManager.findNextTask();
      if (nextTask) {
        statusReport += `\n\n### Next Task Ready:
**Task ${nextTask.id}**: ${nextTask.title}
Priority: ${nextTask.priority}

Execute with:
\`\`\`
task_worker({
  task: "${nextTask.details}",
  workFolder: "${workFolder}"
})
\`\`\``;
      }

      // Add next steps
      statusReport += '\n\n**Next steps:**';
      
      if (nextTask) {
        statusReport += `\n• task_worker task="${nextTask.details.substring(0, 50)}..." workFolder="${workFolder}" - Execute next task`;
        statusReport += `\n• get_next_tasks workFolder="${workFolder}" - Find all ready tasks`;
      }
      
      if (summary.inProgress > 0) {
        statusReport += `\n• work_status - Monitor ${summary.inProgress} running task(s)`;
      }
      
      if (summary.done === summary.total) {
        statusReport += `\n• All tasks complete! Review changes and apply to project`;
      } else {
        statusReport += `\n• set_task_status - Update task statuses as you complete them`;
      }
      
      statusReport += `\n• get_tasks workFolder="${workFolder}" - View detailed task list`;
      
      return statusReport;

    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get task status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create the breakdown prompt for the AI
   */
  private createBreakdownPrompt(args: {
    taskDescription: string;
    scope: string;
    prioritizeSpeed: boolean;
    allowParallel: boolean;
    context?: string;
  }): string {
    const { taskDescription, scope, prioritizeSpeed, allowParallel, context } = args;

    return `You are a senior software architect tasked with breaking down a complex development task into smaller, manageable subtasks.

## Task Description:
${taskDescription}

${context ? `## Additional Context:\n${context}\n` : ''}

## Requirements:
1. Break this down into concrete, actionable tasks as needed
2. Each task should be completable in 30-90 minutes
3. Identify dependencies between tasks
4. ${prioritizeSpeed ? 'Prioritize tasks that can run in parallel' : 'Focus on logical task ordering'}
5. ${allowParallel ? 'Maximize parallel execution opportunities' : 'Keep tasks sequential for simplicity'}
6. Scope: ${scope} complexity project

## Output Format:
Create a file called "tasks.json" in the current directory with this structure:

\`\`\`json
{
  "meta": {
    "projectName": "Optional project name",
    "createdAt": "ISO timestamp",
    "lastModified": "ISO timestamp"
  },
  "tasks": [
    {
      "id": 1,
      "title": "Brief title",
      "description": "One-line description",
      "status": "pending",
      "dependencies": [],
      "priority": "high",
      "details": "Detailed implementation instructions for the developer",
      "testStrategy": "How to verify this task is complete",
      "subtasks": [
        {
          "id": 1,
          "title": "Subtask title",
          "description": "Subtask description",
          "status": "pending",
          "dependencies": [2],
          "priority": "medium"
        }
      ]
    }
  ]
}
\`\`\`

## Guidelines:
- Number tasks sequentially starting from 1
- Use clear, specific titles
- Details should be comprehensive implementation instructions
- Test strategies should be concrete and verifiable
- Set appropriate dependencies (array of task IDs)
- Priority: "high" for critical path, "medium" for normal, "low" for nice-to-have
- Use subtasks when a task has distinct sub-components that can be tracked separately
- Subtasks are referenced as "parentId.subtaskId" (e.g., "1.2" for subtask 2 of task 1)
- Subtask dependencies reference other subtasks within the same parent task

Create the tasks.json file now.`;
  }
}