/**
 * Simple Tasks Schema for claude-parallel-work
 * 
 * Minimal, practical schema inspired by claude-task-master
 * with just enough additions for container-based execution
 */

export interface TasksFile {
  tasks: Task[];
  meta?: {
    projectName?: string;
    createdAt: string;
    lastModified: string;
  };
}

export interface Subtask {
  id: string;                    // Subtask ID: "proj-validation-1", "proj-error-2" (referenced as "parentId.id")
  title: string;                 // Brief title
  description: string;           // One-line description
  status: "pending" | "in-progress" | "done" | "failed";
  dependencies: string[];        // Can reference other subtask IDs within same parent
  priority?: "high" | "medium" | "low"; // Inherits from parent if not specified
}

export interface Task {
  // Core fields (from claude-task-master)
  id: string;                    // Human-readable ID: "project-feature-number" e.g. "cpw-auth-1"
  title: string;                 // Brief title: "Implement auth system"
  description: string;           // One-line description
  status: "pending" | "in-progress" | "done" | "failed";
  dependencies: string[];        // IDs of tasks that must complete first
  priority: "high" | "medium" | "low";
  
  // The actual work
  details: string;              // Implementation instructions (the prompt for code_worker)
  testStrategy: string;         // How to verify completion
  
  // Subtasks support
  subtasks?: Subtask[];         // Optional array of subtasks
  
  // Minimal tracking for claude-parallel-work
  containerId?: string;         // Set when assigned to code_worker
  diffId?: string;             // Set when code_worker returns changes
  error?: string;              // Set if task fails
}

// Helper to create a new task
export function createTask(
  id: string,
  title: string,
  description: string,
  details: string,
  testStrategy: string,
  dependencies: string[] = [],
  priority: "high" | "medium" | "low" = "medium"
): Task {
  return {
    id,
    title,
    description,
    status: "pending",
    dependencies,
    priority,
    details,
    testStrategy
  };
}

// Helper to create a subtask
export function createSubtask(
  id: string,
  title: string,
  description: string,
  dependencies: string[] = [],
  priority?: "high" | "medium" | "low"
): Subtask {
  return {
    id,
    title,
    description,
    status: "pending",
    dependencies,
    ...(priority && { priority })
  };
}

// Get subtask string ID (e.g., "cpw-auth-1.cpw-validation-1" for subtask cpw-validation-1 of task cpw-auth-1)
export function getSubtaskId(taskId: string, subtaskId: string): string {
  return `${taskId}.${subtaskId}`;
}

// Parse subtask string ID back to components
export function parseSubtaskId(subtaskId: string): { taskId: string; subtaskId: string } | null {
  const lastDotIndex = subtaskId.lastIndexOf('.');
  if (lastDotIndex === -1) return null;
  
  const taskId = subtaskId.substring(0, lastDotIndex);
  const subId = subtaskId.substring(lastDotIndex + 1);
  
  if (!taskId || !subId) return null;
  
  return { taskId, subtaskId: subId };
}

// Validate subtask
export function validateSubtask(subtask: any): subtask is Subtask {
  return subtask &&
    typeof subtask.id === 'string' &&
    typeof subtask.title === 'string' &&
    typeof subtask.description === 'string' &&
    ['pending', 'in-progress', 'done', 'failed'].includes(subtask.status) &&
    Array.isArray(subtask.dependencies) &&
    subtask.dependencies.every((d: any) => typeof d === 'string') &&
    (!subtask.priority || ['high', 'medium', 'low'].includes(subtask.priority));
}

// Helper to generate task ID in project-feature-number format
export function generateTaskId(projectPrefix: string, feature: string, number: number): string {
  // Normalize the feature name: lowercase, replace spaces with hyphens
  const normalizedFeature = feature.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${projectPrefix}-${normalizedFeature}-${number}`;
}

// Helper to suggest a project prefix based on project name
export function suggestProjectPrefix(projectName: string): string {
  // Take first letters of each word, or first 3-4 chars if single word
  const words = projectName.split(/\s+/);
  if (words.length > 1) {
    return words.map(w => w[0]).join('').toLowerCase().slice(0, 4);
  }
  return projectName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
}

// Simple validation
export function validateTasksFile(data: any): data is TasksFile {
  return data && 
    Array.isArray(data.tasks) &&
    data.tasks.every((t: any) => 
      typeof t.id === 'string' &&
      typeof t.title === 'string' &&
      typeof t.description === 'string' &&
      typeof t.details === 'string' &&
      ['pending', 'in-progress', 'done', 'failed'].includes(t.status) &&
      Array.isArray(t.dependencies) &&
      t.dependencies.every((d: any) => typeof d === 'string') &&
      ['high', 'medium', 'low'].includes(t.priority) &&
      (!t.subtasks || (Array.isArray(t.subtasks) && t.subtasks.every(validateSubtask)))
    ) &&
    (!data.meta || (
      typeof data.meta === 'object' &&
      (!data.meta.projectName || typeof data.meta.projectName === 'string') &&
      (!data.meta.createdAt || typeof data.meta.createdAt === 'string') &&
      (!data.meta.lastModified || typeof data.meta.lastModified === 'string')
    ));
}