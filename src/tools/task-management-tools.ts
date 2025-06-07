/**
 * Task Management Tools for MCP
 * 
 * Provides tools for agents to manage task statuses and find next tasks
 * Inspired by claude-task-master but optimized for parallel execution
 */

import { SimpleTasksManager } from './simple-tasks-manager.js';
import { Task, parseSubtaskId } from '../types/simple-tasks-schema.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { debugLog } from './debug.js';

export interface SetTaskStatusArgs {
  ids: string; // Comma-separated task/subtask IDs: "1" or "1,2,3" or "1.2" or "1,1.2,2"
  status: 'pending' | 'in-progress' | 'done' | 'failed';
  workFolder: string;
  error?: string; // Optional error message for failed tasks
}

export interface GetTaskArgs {
  id: string;
  workFolder: string;
}

export interface GetTasksArgs {
  workFolder: string;
  status?: 'pending' | 'in-progress' | 'done' | 'failed';
  includeBlocked?: boolean; // Include tasks with unmet dependencies
}

export interface GetNextTasksArgs {
  workFolder: string;
  limit?: number; // Max number of tasks to return (default: all eligible)
}

export class TaskManagementTools {
  /**
   * Set the status of one or more tasks or subtasks
   */
  async setTaskStatus(args: SetTaskStatusArgs): Promise<string> {
    const { ids, status, workFolder, error } = args;
    
    // Parse comma-separated IDs (can be task IDs like "1" or subtask IDs like "1.2")
    const idList = ids.split(',').map(id => id.trim());
    
    const manager = new SimpleTasksManager(workFolder);
    const updatedItems: string[] = [];
    const notFound: string[] = [];

    for (const id of idList) {
      // Check if it's a subtask ID (contains a dot)
      const subtaskParts = parseSubtaskId(id);
      
      if (subtaskParts) {
        // Handle subtask
        try {
          await manager.updateSubtaskStatus(
            subtaskParts.taskId,
            subtaskParts.subtaskId,
            status,
            error
          );
          
          const tasksFile = await manager.read();
          const task = tasksFile?.tasks.find(t => t.id === subtaskParts.taskId);
          const subtask = task?.subtasks?.find(st => st.id === subtaskParts.subtaskId);
          
          if (subtask) {
            updatedItems.push(`${id} (${subtask.title})`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('not found')) {
            notFound.push(id);
          } else {
            throw err;
          }
        }
      } else {
        // Handle regular task
        const tasksFile = await manager.read();
        if (!tasksFile) {
          throw new McpError(ErrorCode.InvalidParams, `No tasks.json found in ${workFolder}`);
        }
        
        const task = tasksFile.tasks.find(t => t.id === id);
        if (!task) {
          notFound.push(id);
          continue;
        }

        // Validate status transitions
        if (status === 'in-progress' && task.status !== 'pending') {
          throw new McpError(
            ErrorCode.InvalidParams, 
            `Task ${id} cannot be marked as in-progress (current status: ${task.status})`
          );
        }

        // Check dependencies for in-progress
        if (status === 'in-progress') {
          const unmetDeps = task.dependencies.filter(depId => {
            const dep = tasksFile.tasks.find(t => t.id === depId);
            return !dep || dep.status !== 'done';
          });
          
          if (unmetDeps.length > 0) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Task ${id} has unmet dependencies: ${unmetDeps.join(', ')}`
            );
          }
        }

        // Update the task
        task.status = status;
        if (error && status === 'failed') {
          task.error = error;
        }
        
        await manager.write(tasksFile);
        updatedItems.push(`${id} (${task.title})`);
      }
    }

    if (notFound.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Items not found: ${notFound.join(', ')}`
      );
    }

    debugLog(`Updated statuses: ${updatedItems.join(', ')} to ${status}`);
    
    const result = [`✅ Updated ${updatedItems.length} item(s) to ${status}:`, ...updatedItems];
    
    result.push('');
    result.push('**Next steps:**');
    
    if (status === 'done') {
      result.push(`• get_next_tasks workFolder="${workFolder}" - Find newly unblocked tasks`);
      result.push(`• get_tasks workFolder="${workFolder}" status="pending" - View remaining work`);
    } else if (status === 'in-progress') {
      result.push(`• task_worker task="..." workFolder="${workFolder}" - Execute the task`);
      result.push(`• work_status - Monitor any background execution`);
    } else if (status === 'failed') {
      result.push(`• get_task id=${idList[0]} workFolder="${workFolder}" - Review task details`);
      result.push(`• task_worker task="fix: ${error || 'retry task'}" workFolder="${workFolder}" - Try again`);
    }
    
    result.push(`• get_tasks workFolder="${workFolder}" - View all task statuses`);
    
    return result.join('\n');
  }

  /**
   * Get details of a specific task
   */
  async getTask(args: GetTaskArgs): Promise<string> {
    const { id, workFolder } = args;
    
    const manager = new SimpleTasksManager(workFolder);
    const tasksFile = await manager.read();
    
    if (!tasksFile) {
      throw new McpError(ErrorCode.InvalidParams, `No tasks.json found in ${workFolder}`);
    }

    const task = tasksFile.tasks.find(t => t.id === id);
    if (!task) {
      throw new McpError(ErrorCode.InvalidParams, `Task ${id} not found`);
    }

    // Check dependency status
    const dependencies = task.dependencies.map(depId => {
      const dep = tasksFile.tasks.find(t => t.id === depId);
      return dep ? `${depId} (${dep.status})` : `${depId} (not found)`;
    });

    // Check if task is blocked
    const isBlocked = task.status === 'pending' && task.dependencies.some(depId => {
      const dep = tasksFile.tasks.find(t => t.id === depId);
      return !dep || dep.status !== 'done';
    });

    const parts = [
      `## Task ${task.id}: ${task.title}`,
      '',
      `**Status**: ${task.status}${isBlocked ? ' (BLOCKED)' : ''}`,
      `**Priority**: ${task.priority}`,
      `**Dependencies**: ${dependencies.length > 0 ? dependencies.join(', ') : 'None'}`,
      `**Description**: ${task.description}`,
      '',
      '**Implementation Details**:',
      task.details,
      '',
      '**Test Strategy**:',
      task.testStrategy
    ];
    
    if (task.containerId) parts.push('', `**Container ID**: ${task.containerId}`);
    if (task.diffId) parts.push(`**Diff ID**: ${task.diffId}`);
    if (task.error) parts.push(`**Error**: ${task.error}`);
    
    if (isBlocked) {
      parts.push('', '⚠️ This task is blocked by incomplete dependencies');
    } else if (task.status === 'pending') {
      parts.push('', '✅ This task is ready to be started');
    }
    
    parts.push('', '**Next steps:**');
    
    if (task.status === 'pending' && !isBlocked) {
      parts.push(`• set_task_status ids="${task.id}" status="in-progress" workFolder="${workFolder}" - Mark as started`);
      parts.push(`• task_worker task="${task.details.substring(0, 50)}..." workFolder="${workFolder}" parentTaskId="${task.id}" - Execute`);
    } else if (task.status === 'in-progress') {
      parts.push(`• work_status - Check execution progress`);
      parts.push(`• set_task_status ids="${task.id}" status="done" workFolder="${workFolder}" - Mark complete`);
    } else if (task.status === 'done') {
      parts.push(`• get_next_tasks workFolder="${workFolder}" - Find tasks unblocked by this`);
      if (task.diffId) {
        parts.push(`• review_changes diffId="${task.diffId}" - Review task changes`);
      }
    } else if (task.status === 'failed') {
      parts.push(`• task_worker task="retry: ${task.title}" workFolder="${workFolder}" - Try again`);
      parts.push(`• set_task_status ids="${task.id}" status="pending" workFolder="${workFolder}" - Reset status`);
    }
    
    parts.push(`• get_tasks workFolder="${workFolder}" - View all tasks`);
    
    return parts.join('\n');
  }

  /**
   * Get all tasks or filter by status
   */
  async getTasks(args: GetTasksArgs): Promise<string> {
    const { workFolder, status, includeBlocked = true } = args;
    
    const manager = new SimpleTasksManager(workFolder);
    const tasksFile = await manager.read();
    
    if (!tasksFile) {
      return `No tasks.json found in the specified directory.`;
    }

    let tasks = tasksFile.tasks;
    
    // Filter by status if specified
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }

    // Identify blocked tasks
    const doneIds = new Set(tasksFile.tasks.filter(t => t.status === 'done').map(t => t.id));
    const blockedTasks = new Set<string>();
    
    tasks.forEach(task => {
      if (task.status === 'pending' && task.dependencies.some(depId => !doneIds.has(depId))) {
        blockedTasks.add(task.id);
      }
    });

    // Filter out blocked tasks if requested
    if (!includeBlocked) {
      tasks = tasks.filter(t => !blockedTasks.has(t.id));
    }

    if (tasks.length === 0) {
      const message = status 
        ? `No tasks found with status: ${status}`
        : 'No tasks found.';
      return `${message}`;
    }

    // Group by status
    const byStatus = {
      'done': tasks.filter(t => t.status === 'done'),
      'in-progress': tasks.filter(t => t.status === 'in-progress'),
      'pending': tasks.filter(t => t.status === 'pending' && !blockedTasks.has(t.id)),
      'blocked': tasks.filter(t => blockedTasks.has(t.id)),
      'failed': tasks.filter(t => t.status === 'failed')
    };

    const sections: string[] = [];
    
    if (byStatus['in-progress'].length > 0) {
      sections.push(`## 🔄 In Progress (${byStatus['in-progress'].length})
${byStatus['in-progress'].map(t => {
        let line = `- **${t.id}**: ${t.title}`;
        if (t.subtasks && t.subtasks.length > 0) {
          const subtaskSummary = t.subtasks.reduce((acc, st) => {
            acc[st.status] = (acc[st.status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          line += ` (${Object.entries(subtaskSummary).map(([status, count]) => `${count} ${status}`).join(', ')})`;
        }
        return line;
      }).join('\n')}`);
    }

    if (byStatus.pending.length > 0) {
      sections.push(`## ⏳ Ready to Start (${byStatus.pending.length})
${byStatus.pending.map(t => `- **${t.id}**: ${t.title} (${t.priority})`).join('\n')}`);
    }

    if (byStatus.blocked.length > 0) {
      sections.push(`## 🚫 Blocked (${byStatus.blocked.length})
${byStatus.blocked.map(t => {
        const deps = t.dependencies.join(', ');
        return `- **${t.id}**: ${t.title} (waiting for: ${deps})`;
      }).join('\n')}`);
    }

    if (byStatus.done.length > 0) {
      sections.push(`## ✅ Completed (${byStatus.done.length})
${byStatus.done.map(t => `- **${t.id}**: ${t.title}`).join('\n')}`);
    }

    if (byStatus.failed.length > 0) {
      sections.push(`## ❌ Failed (${byStatus.failed.length})
${byStatus.failed.map(t => `- **${t.id}**: ${t.title}${t.error ? ` - ${t.error}` : ''}`).join('\n')}`);
    }

    const summary = await manager.getSummary();
    
    const parts = [
      '# Task Overview',
      '',
      `**Total**: ${summary.total} | **Done**: ${summary.done} | **In Progress**: ${summary.inProgress} | **Ready**: ${summary.pending} | **Blocked**: ${summary.blocked} | **Failed**: ${summary.failed}`,
      '',
      sections.join('\n\n'),
      '',
      '**Next steps:**'
    ];
    
    if (byStatus.pending.length > 0) {
      parts.push(`• get_next_tasks workFolder="${workFolder}" - Get all ${byStatus.pending.length} ready task(s)`);
      parts.push(`• task_worker task="..." workFolder="${workFolder}" - Execute ready tasks`);
    }
    
    if (byStatus['in-progress'].length > 0) {
      parts.push(`• work_status - Monitor ${byStatus['in-progress'].length} running task(s)`);
      parts.push(`• set_task_status ids="..." status="done" workFolder="${workFolder}" - Mark completed tasks`);
    }
    
    if (byStatus.failed.length > 0) {
      parts.push(`• get_task id=X workFolder="${workFolder}" - Review failed task details`);
      parts.push(`• set_task_status ids="..." status="pending" workFolder="${workFolder}" - Reset failed tasks`);
    }
    
    if (summary.done === summary.total) {
      parts.push(`• review_changes - Review all changes from completed tasks`);
      parts.push(`• apply_changes - Apply approved changes to project`);
    }
    
    return parts.join('\n');
  }

  /**
   * Get next tasks that can be executed in parallel
   * Returns ALL tasks that are ready to run (satisfied dependencies)
   */
  async getNextTasks(args: GetNextTasksArgs): Promise<string> {
    const { workFolder, limit } = args;
    
    const manager = new SimpleTasksManager(workFolder);
    const tasksFile = await manager.read();
    
    if (!tasksFile) {
      return `No tasks.json found.`;
    }

    // Get completed task IDs
    const completedIds = new Set(
      tasksFile.tasks
        .filter(t => t.status === 'done')
        .map(t => t.id)
    );

    // Find all tasks ready to run
    const readyTasks = tasksFile.tasks.filter(task => {
      // Must be pending
      if (task.status !== 'pending') return false;
      
      // All dependencies must be completed
      return task.dependencies.every(depId => completedIds.has(depId));
    });

    if (readyTasks.length === 0) {
      const inProgress = tasksFile.tasks.filter(t => t.status === 'in-progress');
      const blocked = tasksFile.tasks.filter(t => 
        t.status === 'pending' && 
        t.dependencies.some(depId => !completedIds.has(depId))
      );

      if (inProgress.length > 0) {
        const parts = [
          `No tasks ready to start. ${inProgress.length} task(s) currently in progress:`,
          ...inProgress.map(t => `- ${t.id}: ${t.title}`),
          '',
          '**Next steps:**',
          `• work_status - Monitor progress of in-progress tasks`,
          `• set_task_status ids="${inProgress.map(t => t.id).join(',')}" status="done" workFolder="${workFolder}" - Mark as complete`,
          `• get_tasks workFolder="${workFolder}" status="in-progress" - View details`
        ];
        return parts.join('\n');
      } else if (blocked.length > 0) {
        return `No tasks ready to start. ${blocked.length} task(s) are blocked by dependencies.\n\n**Next steps:**\n• get_tasks workFolder="${workFolder}" status="pending" - View blocked tasks\n• get_tasks workFolder="${workFolder}" status="in-progress" - Check what's running`;
      } else {
        return `All tasks have been completed! 🎉\n\n**Next steps:**\n• review_changes - Review any pending changes\n• apply_changes - Apply approved changes\n• git commit - Commit your work`;
      }
    }

    // Sort by priority and dependencies
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    readyTasks.sort((a, b) => {
      // First by priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by number of dependencies (fewer deps first)
      const depDiff = a.dependencies.length - b.dependencies.length;
      if (depDiff !== 0) return depDiff;
      
      // Finally by ID (string comparison)
      return a.id.localeCompare(b.id);
    });

    // Apply limit if specified
    const tasksToReturn = limit ? readyTasks.slice(0, limit) : readyTasks;

    // Format the response
    const taskList = tasksToReturn.map(task => {
      return `## Task ${task.id}: ${task.title}
**Priority**: ${task.priority}
**Dependencies**: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None'}
**Description**: ${task.description}

Execute with:
\`\`\`
task_worker task="${task.details}" workFolder="${workFolder}" parentTaskId="${task.id}"
\`\`\``;
    }).join('\n\n---\n\n');

    const header = tasksToReturn.length === 1 
      ? '# Next Task Ready for Execution'
      : `# ${tasksToReturn.length} Tasks Ready for Parallel Execution`;

    const footer = readyTasks.length > tasksToReturn.length
      ? `\n\n*Note: Showing ${tasksToReturn.length} of ${readyTasks.length} ready tasks.*`
      : '';

    const result = [header, '', taskList];
    
    if (footer) result.push(footer);
    
    result.push('', '**Next steps:**');
    result.push(`• Execute the task_worker commands above for each task`);
    result.push(`• set_task_status ids="${tasksToReturn.map(t => t.id).join(',')}" status="in-progress" workFolder="${workFolder}" - Mark all as started`);
    result.push(`• work_status - Monitor parallel execution progress`);
    
    return result.join('\n');
  }
}