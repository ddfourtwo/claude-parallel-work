/**
 * Tasks.json Validation Tools
 * 
 * MCP tools for validating and verifying tasks.json format
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { validateTasksFile, validateSubtask } from '../types/simple-tasks-schema.js';
import { SimpleTasksManager } from './simple-tasks-manager.js';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface ValidateTasksArgs {
  workFolder: string;
}

export const tasksValidationTools: Tool[] = [
  {
    name: 'validate_tasks',
    description: 'Validate the format and integrity of tasks.json in the project root',
    inputSchema: {
      type: 'object',
      properties: {
        workFolder: {
          type: 'string',
          description: 'Project directory containing tasks.json'
        }
      },
      required: ['workFolder']
    }
  }
];

/**
 * Detailed validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalSubtasks: number;
    tasksWithDependencies: number;
    unresolvedDependencies: number;
  };
}

/**
 * Validate tasks.json with detailed feedback
 */
export async function handleTasksValidationTools(
  toolName: string,
  args: any
): Promise<string> {
  switch (toolName) {
    case 'validate_tasks':
      return validateTasks(args as ValidateTasksArgs);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function validateTasks(args: ValidateTasksArgs): Promise<string> {
  const { workFolder } = args;
  const tasksPath = path.join(workFolder, 'tasks.json');
  
  try {
    // Check if file exists
    try {
      await fs.access(tasksPath);
    } catch {
      return `❌ No tasks.json file found in ${workFolder}`;
    }
    
    // Read the file
    const content = await fs.readFile(tasksPath, 'utf-8');
    let data: any;
    
    try {
      data = JSON.parse(content);
    } catch (error) {
      return `❌ Invalid JSON in tasks.json

**Error:** ${error instanceof Error ? error.message : String(error)}

**Location:** ${tasksPath}

**Next steps:**
• Fix the JSON syntax error manually
• Ensure the file contains valid JSON (check for trailing commas, missing quotes, etc.)`;
    }
    
    // Perform validation
    const result = await performDetailedValidation(data);
    
    // Format the response
    return formatValidationResult(result, workFolder);
    
  } catch (error) {
    return `❌ Error validating tasks.json: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function performDetailedValidation(data: any): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Initialize stats
  const stats = {
    totalTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalSubtasks: 0,
    tasksWithDependencies: 0,
    unresolvedDependencies: 0
  };
  
  // Check basic structure
  if (!data || typeof data !== 'object') {
    errors.push('tasks.json must be an object');
    return { valid: false, errors, warnings, stats };
  }
  
  if (!Array.isArray(data.tasks)) {
    errors.push('tasks.json must have a "tasks" array');
    return { valid: false, errors, warnings, stats };
  }
  
  // Track task IDs for dependency validation
  const taskIds = new Set<string>();
  const subtaskIds = new Set<string>();
  
  // Validate each task
  data.tasks.forEach((task: any, index: number) => {
    stats.totalTasks++;
    
    // Required fields
    if (typeof task.id !== 'string') {
      errors.push(`Task at index ${index}: missing or invalid "id" (must be a string in format "project-feature-number")`);
    } else {
      if (taskIds.has(task.id)) {
        errors.push(`Task at index ${index}: duplicate ID ${task.id}`);
      }
      taskIds.add(task.id);
    }
    
    if (!task.title || typeof task.title !== 'string') {
      errors.push(`Task ${task.id || index}: missing or invalid "title"`);
    }
    
    if (!task.description || typeof task.description !== 'string') {
      errors.push(`Task ${task.id || index}: missing or invalid "description"`);
    }
    
    if (!task.details || typeof task.details !== 'string') {
      errors.push(`Task ${task.id || index}: missing or invalid "details"`);
    }
    
    if (!task.testStrategy) {
      warnings.push(`Task ${task.id || index}: missing "testStrategy" field`);
    }
    
    // Status validation
    if (!task.status || !['pending', 'in-progress', 'done', 'failed'].includes(task.status)) {
      errors.push(`Task ${task.id || index}: invalid status "${task.status}"`);
    }
    
    // Count by status
    switch (task.status) {
      case 'pending': stats.pendingTasks++; break;
      case 'in-progress': stats.inProgressTasks++; break;
      case 'done': stats.completedTasks++; break;
      case 'failed': stats.failedTasks++; break;
    }
    
    // Priority validation
    if (!task.priority || !['high', 'medium', 'low'].includes(task.priority)) {
      errors.push(`Task ${task.id || index}: invalid priority "${task.priority}"`);
    }
    
    // Dependencies validation
    if (!Array.isArray(task.dependencies)) {
      errors.push(`Task ${task.id || index}: dependencies must be an array`);
    } else {
      if (task.dependencies.length > 0) {
        stats.tasksWithDependencies++;
      }
      task.dependencies.forEach((dep: any) => {
        if (typeof dep !== 'string') {
          errors.push(`Task ${task.id || index}: dependency "${dep}" must be a string`);
        }
      });
    }
    
    // Validate subtasks if present
    if (task.subtasks) {
      if (!Array.isArray(task.subtasks)) {
        errors.push(`Task ${task.id || index}: subtasks must be an array`);
      } else {
        stats.totalSubtasks += task.subtasks.length;
        
        const subtaskIdsInTask = new Set<string>();
        task.subtasks.forEach((subtask: any, subIndex: number) => {
          if (!validateSubtask(subtask)) {
            errors.push(`Task ${task.id || index}, subtask ${subIndex}: invalid subtask format`);
          } else {
            if (subtaskIdsInTask.has(subtask.id)) {
              errors.push(`Task ${task.id || index}: duplicate subtask ID ${subtask.id}`);
            }
            subtaskIdsInTask.add(subtask.id);
            subtaskIds.add(`${task.id}.${subtask.id}`);
          }
        });
      }
    }
  });
  
  // Validate dependencies reference existing tasks
  data.tasks.forEach((task: any) => {
    if (Array.isArray(task.dependencies)) {
      task.dependencies.forEach((depId: string) => {
        if (!taskIds.has(depId)) {
          errors.push(`Task ${task.id}: dependency ${depId} references non-existent task`);
          stats.unresolvedDependencies++;
        }
      });
    }
    
    // Check subtask dependencies
    if (task.subtasks && Array.isArray(task.subtasks)) {
      task.subtasks.forEach((subtask: any) => {
        if (Array.isArray(subtask.dependencies)) {
          subtask.dependencies.forEach((depId: string) => {
            const fullSubtaskId = `${task.id}.${depId}`;
            if (!subtaskIds.has(fullSubtaskId) && !taskIds.has(depId)) {
              warnings.push(`Task ${task.id}, subtask ${subtask.id}: dependency ${depId} might reference non-existent subtask`);
            }
          });
        }
      });
    }
  });
  
  // Check for circular dependencies
  const circularDeps = findCircularDependencies(data.tasks);
  if (circularDeps.length > 0) {
    circularDeps.forEach(cycle => {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
    });
  }
  
  // Additional warnings
  if (stats.inProgressTasks > 3) {
    warnings.push(`${stats.inProgressTasks} tasks are in-progress. Consider focusing on fewer tasks at once.`);
  }
  
  if (stats.failedTasks > 0) {
    warnings.push(`${stats.failedTasks} tasks have failed. Review and update their status or retry.`);
  }
  
  // Use the built-in validation function for final check
  const valid = validateTasksFile(data) && errors.length === 0;
  
  return { valid, errors, warnings, stats };
}

function findCircularDependencies(tasks: any[]): string[][] {
  const cycles: string[][] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  
  function dfs(taskId: string, visited: Set<string>, path: string[]): void {
    if (path.includes(taskId)) {
      const cycleStart = path.indexOf(taskId);
      cycles.push([...path.slice(cycleStart), taskId]);
      return;
    }
    
    if (visited.has(taskId)) return;
    visited.add(taskId);
    
    const task = taskMap.get(taskId);
    if (task && Array.isArray(task.dependencies)) {
      for (const depId of task.dependencies) {
        dfs(depId, visited, [...path, taskId]);
      }
    }
  }
  
  const visited = new Set<string>();
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id, visited, []);
    }
  }
  
  return cycles;
}

function formatValidationResult(result: ValidationResult, workFolder: string): string {
  const { valid, errors, warnings, stats } = result;
  
  let output = '';
  
  if (valid) {
    output += `✅ tasks.json is valid!\n\n`;
  } else {
    output += `❌ tasks.json validation failed\n\n`;
  }
  
  // Statistics
  output += `## Task Statistics\n`;
  output += `**Total Tasks:** ${stats.totalTasks}\n`;
  output += `**Status Breakdown:**\n`;
  output += `• Pending: ${stats.pendingTasks}\n`;
  output += `• In Progress: ${stats.inProgressTasks}\n`;
  output += `• Completed: ${stats.completedTasks}\n`;
  output += `• Failed: ${stats.failedTasks}\n`;
  if (stats.totalSubtasks > 0) {
    output += `**Subtasks:** ${stats.totalSubtasks}\n`;
  }
  output += `**Dependencies:** ${stats.tasksWithDependencies} tasks have dependencies\n`;
  if (stats.unresolvedDependencies > 0) {
    output += `**Unresolved Dependencies:** ${stats.unresolvedDependencies}\n`;
  }
  output += '\n';
  
  // Errors
  if (errors.length > 0) {
    output += `## Errors (${errors.length})\n`;
    errors.forEach(error => {
      output += `• ❌ ${error}\n`;
    });
    output += '\n';
  }
  
  // Warnings
  if (warnings.length > 0) {
    output += `## Warnings (${warnings.length})\n`;
    warnings.forEach(warning => {
      output += `• ⚠️ ${warning}\n`;
    });
    output += '\n';
  }
  
  // Next steps
  output += `## Next Steps\n`;
  if (valid) {
    output += `• get_next_tasks workFolder="${workFolder}" - Find tasks ready for execution\n`;
    output += `• get_tasks workFolder="${workFolder}" - View all tasks\n`;
    output += `• task_worker task="..." workFolder="${workFolder}" - Execute a specific task\n`;
  } else {
    output += `• Edit the tasks.json file to fix validation errors\n`;
  }
  
  return output;
}