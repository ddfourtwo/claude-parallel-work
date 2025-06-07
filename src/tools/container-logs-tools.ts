/**
 * Container Logs Management Tools
 * 
 * Provides tools for viewing and managing container execution logs
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use __dirname to get the directory of this file, then navigate to logs
// Note: In compiled code, __dirname will be in dist/, so logs end up in dist/logs/
// This ensures we're always looking in the correct logs directory
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
async function ensureLogsDir(): Promise<void> {
  if (!existsSync(LOGS_DIR)) {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  }
}

export interface ViewLogsArgs {
  identifier: string; // taskId or containerId
  tail?: number; // Number of lines from end (optional)
  filter?: string; // Filter lines containing this text
}

export interface ListLogsArgs {
  limit?: number; // Limit number of files returned
  sortBy?: 'newest' | 'oldest' | 'size';
}

// Internal interface for automatic cleanup
interface ClearLogsArgs {
  olderThanHours?: number;
  pattern?: string;
}

/**
 * View container logs by task ID or container ID
 */
export const viewContainerLogsTools: Tool[] = [
  {
    name: 'view_container_logs',
    description: 'View logs from a container execution by task ID or container ID',
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
    }
  },
  {
    name: 'list_container_logs',
    description: 'List available container log files',
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
    }
  }
];

/**
 * Container logs handler implementation
 */
export async function handleContainerLogsTools(
  toolName: string,
  args: any
): Promise<string> {
  await ensureLogsDir();

  switch (toolName) {
    case 'view_container_logs':
      return viewContainerLogs(args as ViewLogsArgs);
    case 'list_container_logs':
      return listContainerLogs(args as ListLogsArgs);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * View logs for a specific container/task
 */
async function viewContainerLogs(args: ViewLogsArgs): Promise<string> {
  const { identifier, tail, filter } = args;
  
  // Find log files matching the identifier
  const files = await fs.readdir(LOGS_DIR);
  const matchingFiles = files.filter(f => 
    f.includes(identifier) && (f.endsWith('.log') || f.endsWith('.txt'))
  );

  if (matchingFiles.length === 0) {
    return `No log files found for identifier: ${identifier}\n\nAvailable identifiers:\n${await getAvailableIdentifiers()}`;
  }

  // If multiple files, use the most recent
  const logFile = matchingFiles.sort().reverse()[0];
  const logPath = path.join(LOGS_DIR, logFile);
  
  try {
    let content = await fs.readFile(logPath, 'utf-8');
    
    // Apply filter if specified
    if (filter) {
      const lines = content.split('\n');
      content = lines.filter(line => line.toLowerCase().includes(filter.toLowerCase())).join('\n');
    }
    
    // Apply tail if specified
    if (tail && tail > 0) {
      const lines = content.split('\n');
      content = lines.slice(-tail).join('\n');
    }
    
    const stats = await fs.stat(logPath);
    const header = `## Container Logs: ${identifier}\n` +
                  `**File:** ${logFile}\n` +
                  `**Size:** ${formatBytes(stats.size)}\n` +
                  `**Modified:** ${stats.mtime.toISOString()}\n` +
                  `${filter ? `**Filter:** "${filter}"\n` : ''}` +
                  `${tail ? `**Showing last ${tail} lines**\n` : ''}\n` +
                  `${'─'.repeat(60)}\n\n`;
    
    return header + content;
    
  } catch (error) {
    return `Error reading log file: ${error}`;
  }
}

/**
 * List available container logs
 */
async function listContainerLogs(args: ListLogsArgs): Promise<string> {
  const { limit = 20, sortBy = 'newest' } = args;
  
  const files = await fs.readdir(LOGS_DIR);
  const logFiles = files.filter(f => f.endsWith('.log') || f.endsWith('.txt'));
  
  if (logFiles.length === 0) {
    return 'No container log files found.';
  }
  
  // Get file stats
  const fileStats = await Promise.all(
    logFiles.map(async (file) => {
      const filePath = path.join(LOGS_DIR, file);
      const stats = await fs.stat(filePath);
      return { file, stats };
    })
  );
  
  // Sort files
  switch (sortBy) {
    case 'oldest':
      fileStats.sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime());
      break;
    case 'size':
      fileStats.sort((a, b) => b.stats.size - a.stats.size);
      break;
    case 'newest':
    default:
      fileStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
  }
  
  // Apply limit
  const limitedStats = fileStats.slice(0, limit);
  
  let output = `## Container Log Files (${limitedStats.length} of ${fileStats.length})\n\n`;
  output += `| File | Size | Modified | Task/Container ID |\n`;
  output += `|------|------|----------|------------------|\n`;
  
  for (const { file, stats } of limitedStats) {
    const identifier = extractIdentifier(file);
    output += `| ${file} | ${formatBytes(stats.size)} | ${formatTime(stats.mtime)} | ${identifier} |\n`;
  }
  
  if (fileStats.length > limit) {
    output += `\n*Showing ${limit} of ${fileStats.length} files. Use limit parameter to see more.*\n`;
  }
  
  return output;
}

/**
 * Clear old log files - Internal function for automatic cleanup
 * Not exposed as a tool to agents
 */
export async function clearOldLogs(args: ClearLogsArgs): Promise<string> {
  const { olderThanHours = 24, pattern } = args;
  
  const files = await fs.readdir(LOGS_DIR);
  const logFiles = files.filter(f => {
    if (!f.endsWith('.log') && !f.endsWith('.txt')) return false;
    if (pattern && !f.includes(pattern)) return false;
    return true;
  });
  
  const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
  let deletedCount = 0;
  let totalSize = 0;
  
  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);
    const stats = await fs.stat(filePath);
    
    if (stats.mtime.getTime() < cutoffTime) {
      totalSize += stats.size;
      await fs.unlink(filePath);
      deletedCount++;
    }
  }
  
  return `## Log Cleanup Complete\n\n` +
         `**Deleted:** ${deletedCount} files\n` +
         `**Space freed:** ${formatBytes(totalSize)}\n` +
         `**Criteria:** Files older than ${olderThanHours} hours` +
         `${pattern ? ` matching pattern "${pattern}"` : ''}`;
}

/**
 * Get available task/container identifiers
 */
async function getAvailableIdentifiers(): Promise<string> {
  const files = await fs.readdir(LOGS_DIR);
  const identifiers = new Set<string>();
  
  for (const file of files) {
    const id = extractIdentifier(file);
    if (id) identifiers.add(id);
  }
  
  return Array.from(identifiers).sort().join('\n');
}

/**
 * Extract task/container ID from filename
 */
function extractIdentifier(filename: string): string {
  // Pattern: task-{taskId}-{timestamp}.log or container-{containerId}-{timestamp}.log
  const match = filename.match(/(task-[\w-]+|container-[\w]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Format time to relative
 */
function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
  return Math.floor(diff / 86400000) + ' days ago';
}