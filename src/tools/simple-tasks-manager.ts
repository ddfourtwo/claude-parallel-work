/**
 * Simple Tasks Manager for claude-parallel-work
 * 
 * Minimal implementation focused on agent needs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TasksFile, Task, Subtask, validateTasksFile, getSubtaskId, parseSubtaskId } from '../types/simple-tasks-schema.js';
import { debugLog } from './debug.js';

export class SimpleTasksManager {
  private workFolder: string;
  private tasksFilePath: string;

  constructor(workFolder: string) {
    this.workFolder = workFolder;
    this.tasksFilePath = path.join(workFolder, 'tasks.json');
  }

  /**
   * Read tasks.json
   */
  async read(): Promise<TasksFile | null> {
    try {
      const content = await fs.readFile(this.tasksFilePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!validateTasksFile(data)) {
        throw new Error('Invalid tasks.json format');
      }
      
      return data;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write tasks.json
   */
  async write(tasks: TasksFile): Promise<void> {
    // Update lastModified in meta
    if (!tasks.meta) {
      tasks.meta = {
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };
    } else {
      tasks.meta.lastModified = new Date().toISOString();
    }
    
    const content = JSON.stringify(tasks, null, 2);
    await fs.writeFile(this.tasksFilePath, content, 'utf-8');
    debugLog(`Wrote ${tasks.tasks.length} tasks to ${this.tasksFilePath}`);
  }

  /**
   * Find next task to work on
   * Returns first pending task with all dependencies satisfied
   */
  async findNextTask(): Promise<Task | null> {
    const tasksFile = await this.read();
    if (!tasksFile) return null;

    const completedIds = new Set(
      tasksFile.tasks
        .filter(t => t.status === 'done')
        .map(t => t.id)
    );

    // Find tasks that are ready to run
    const readyTasks = tasksFile.tasks.filter(task => {
      if (task.status !== 'pending') return false;
      
      // Check if all dependencies are completed
      return task.dependencies.every(depId => completedIds.has(depId));
    });

    // Sort by priority (high > medium > low) then by ID
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    readyTasks.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      return priorityDiff !== 0 ? priorityDiff : a.id.localeCompare(b.id);
    });

    return readyTasks[0] || null;
  }

  /**
   * Find all tasks ready to work on
   * Returns all pending tasks with dependencies satisfied
   */
  async findAllReadyTasks(): Promise<Task[]> {
    const tasksFile = await this.read();
    if (!tasksFile) return [];

    const completedIds = new Set(
      tasksFile.tasks
        .filter(t => t.status === 'done')
        .map(t => t.id)
    );

    // Find tasks that are ready to run
    const readyTasks = tasksFile.tasks.filter(task => {
      if (task.status !== 'pending') return false;
      
      // Check if all dependencies are completed
      return task.dependencies.every(depId => completedIds.has(depId));
    });

    // Sort by priority (high > medium > low) then by ID
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    readyTasks.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      return priorityDiff !== 0 ? priorityDiff : a.id.localeCompare(b.id);
    });

    return readyTasks;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string, 
    status: Task['status'],
    updates?: { containerId?: string; error?: string }
  ): Promise<void> {
    const tasksFile = await this.read();
    if (!tasksFile) {
      throw new Error('No tasks.json file found');
    }

    const task = tasksFile.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = status;
    if (updates?.containerId) task.containerId = updates.containerId;
    if (updates?.error) task.error = updates.error;

    await this.write(tasksFile);
  }

  /**
   * Get a simple status summary
   */
  async getSummary(): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    failed: number;
    blocked: number;
  }> {
    const tasksFile = await this.read();
    if (!tasksFile) {
      return { total: 0, pending: 0, inProgress: 0, done: 0, failed: 0, blocked: 0 };
    }

    const tasks = tasksFile.tasks;
    const doneIds = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));
    
    const blocked = tasks.filter(t => 
      t.status === 'pending' && 
      t.dependencies.some(depId => !doneIds.has(depId))
    ).length;

    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length - blocked,
      inProgress: tasks.filter(t => t.status === 'in-progress').length,
      done: tasks.filter(t => t.status === 'done').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      blocked
    };
  }

  /**
   * Create tasks.json from a plan
   */
  async createFromPlan(tasks: Task[]): Promise<void> {
    // Check if tasks.json already exists
    if (await this.exists()) {
      const existing = await this.read();
      if (existing && existing.tasks.some(t => t.status === 'in-progress')) {
        throw new Error('Cannot overwrite tasks.json while tasks are in progress');
      }
    }

    const tasksFile: TasksFile = { tasks };
    await this.write(tasksFile);
  }

  /**
   * Check if tasks.json exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.tasksFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear tasks.json
   */
  async clear(): Promise<void> {
    if (await this.exists()) {
      await fs.unlink(this.tasksFilePath);
      debugLog(`Removed tasks.json from ${this.workFolder}`);
    }
  }

  /**
   * Generate individual task files (like claude-task-master)
   */
  async generateTaskFiles(): Promise<void> {
    const tasksFile = await this.read();
    if (!tasksFile) return;

    const tasksDir = path.join(this.workFolder, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    for (const task of tasksFile.tasks) {
      const filename = `task_${task.id}.txt`;
      const filepath = path.join(tasksDir, filename);
      
      const content = `# Task ID: ${task.id}
# Title: ${task.title}
# Status: ${task.status}
# Dependencies: ${task.dependencies.join(', ') || 'None'}
# Priority: ${task.priority}
# Description: ${task.description}

# Details:
${task.details}

# Test Strategy:
${task.testStrategy}

${task.containerId ? `# Container ID: ${task.containerId}` : ''}
${task.error ? `# Error: ${task.error}` : ''}`;

      await fs.writeFile(filepath, content, 'utf-8');
    }

    debugLog(`Generated ${tasksFile.tasks.length} task files in ${tasksDir}`);
  }

  /**
   * Update subtask status
   */
  async updateSubtaskStatus(
    taskId: string,
    subtaskId: string,
    status: Subtask['status'],
    error?: string
  ): Promise<void> {
    const tasksFile = await this.read();
    if (!tasksFile) {
      throw new Error('No tasks.json file found');
    }

    const task = tasksFile.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!task.subtasks) {
      throw new Error(`Task ${taskId} has no subtasks`);
    }

    const subtask = task.subtasks.find(st => st.id === subtaskId);
    if (!subtask) {
      throw new Error(`Subtask ${subtaskId} not found in task ${taskId}`);
    }

    subtask.status = status;
    if (error && status === 'failed') {
      // Store error at task level for now
      task.error = `Subtask ${subtaskId} failed: ${error}`;
    }

    await this.write(tasksFile);
  }

  /**
   * Find next subtask to work on
   * Returns first pending subtask with dependencies satisfied in any in-progress task
   */
  async findNextSubtask(): Promise<{ task: Task; subtask: Subtask } | null> {
    const tasksFile = await this.read();
    if (!tasksFile) return null;

    // First, prioritize subtasks in in-progress tasks
    const inProgressTasks = tasksFile.tasks.filter(t => t.status === 'in-progress' && t.subtasks);

    for (const task of inProgressTasks) {
      if (!task.subtasks) continue;

      const completedSubtaskIds = new Set(
        task.subtasks
          .filter(st => st.status === 'done')
          .map(st => st.id)
      );

      const readySubtasks = task.subtasks.filter(subtask => {
        if (subtask.status !== 'pending') return false;
        return subtask.dependencies.every(depId => completedSubtaskIds.has(depId));
      });

      if (readySubtasks.length > 0) {
        // Sort by priority (use parent's if not specified)
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        readySubtasks.sort((a, b) => {
          const aPriority = a.priority || task.priority;
          const bPriority = b.priority || task.priority;
          const priorityDiff = priorityOrder[bPriority] - priorityOrder[aPriority];
          return priorityDiff !== 0 ? priorityDiff : a.id.localeCompare(b.id);
        });

        return { task, subtask: readySubtasks[0] };
      }
    }

    return null;
  }

  /**
   * Get a summary including subtasks
   */
  async getDetailedSummary(): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    failed: number;
    blocked: number;
    subtasks: {
      total: number;
      pending: number;
      inProgress: number;
      done: number;
      failed: number;
    };
  }> {
    const tasksFile = await this.read();
    if (!tasksFile) {
      return {
        total: 0, pending: 0, inProgress: 0, done: 0, failed: 0, blocked: 0,
        subtasks: { total: 0, pending: 0, inProgress: 0, done: 0, failed: 0 }
      };
    }

    const summary = await this.getSummary();
    
    // Count subtasks
    let subtaskCounts = {
      total: 0,
      pending: 0,
      inProgress: 0,
      done: 0,
      failed: 0
    };

    for (const task of tasksFile.tasks) {
      if (task.subtasks) {
        subtaskCounts.total += task.subtasks.length;
        for (const subtask of task.subtasks) {
          switch (subtask.status) {
            case 'pending': subtaskCounts.pending++; break;
            case 'in-progress': subtaskCounts.inProgress++; break;
            case 'done': subtaskCounts.done++; break;
            case 'failed': subtaskCounts.failed++; break;
          }
        }
      }
    }

    return {
      ...summary,
      subtasks: subtaskCounts
    };
  }
}