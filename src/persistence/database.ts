/**
 * SQLite Database Persistence Manager
 * Provides persistent storage for background tasks, git diffs, and container state
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import type { BackgroundTask } from '../tools/claude-code-git-integrated.js';
import type { GitDiff } from '../types/git-diff-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export interface PersistedBackgroundTask {
  id: string;
  args: string; // JSON
  status: string;
  start_time: number;
  end_time?: number;
  container_id?: string;
  result?: string; // JSON
  error?: string;
  progress?: string;
  session_id?: string;
  pending_question?: string;
}

export interface PersistedGitDiff {
  id: string;
  container_id: string;
  created_at: number;
  workspace_path: string;
  files_changed: number;
  additions: number;
  deletions: number;
  diff_content: string;
  status: string;
  applied_at?: number;
  applied_to?: string;
}

export interface PersistedContainer {
  id: string;
  name: string;
  task_id?: string;
  status: string;
  created_at: number;
  last_used?: number;
  auth_configured: boolean;
  workspace_configured: boolean;
  workspace_path?: string;
}

export class PersistenceManager {
  private db: Database.Database;
  
  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(dataDir, 'claude-parallel.db');
    
    logger.info('Initializing persistence manager', { dbPath: finalPath });
    
    try {
      this.db = new Database(finalPath);
      this.db.pragma('journal_mode = WAL'); // Better concurrent access
      this.db.pragma('synchronous = NORMAL'); // Balance safety/performance
      this.initializeSchema();
      
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database', {
        error: error instanceof Error ? error.message : String(error),
        dbPath: finalPath
      });
      throw error;
    }
  }

  private initializeSchema(): void {
    logger.info('Initializing database schema');
    
    // Background tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS background_tasks (
        id TEXT PRIMARY KEY,
        args TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        container_id TEXT,
        result TEXT,
        error TEXT,
        progress TEXT,
        session_id TEXT,
        pending_question TEXT
      )
    `);

    // Git diffs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS git_diffs (
        id TEXT PRIMARY KEY,
        container_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_path TEXT NOT NULL,
        files_changed INTEGER,
        additions INTEGER,
        deletions INTEGER,
        diff_content TEXT,
        status TEXT DEFAULT 'pending',
        applied_at INTEGER,
        applied_to TEXT
      )
    `);

    // Container registry table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        task_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER,
        auth_configured BOOLEAN DEFAULT 0,
        workspace_configured BOOLEAN DEFAULT 0,
        workspace_path TEXT
      )
    `);

    // Execution logs reference table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        container_id TEXT,
        log_file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        size_bytes INTEGER
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_git_diffs_status ON git_diffs(status);
      CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
      CREATE INDEX IF NOT EXISTS idx_containers_task_id ON containers(task_id);
    `);
  }

  // Background task methods
  async saveBackgroundTask(task: BackgroundTask): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO background_tasks 
      (id, args, status, start_time, end_time, container_id, result, error, progress, session_id, pending_question)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    try {
      stmt.run(
        task.id,
        JSON.stringify(task.args),
        task.status,
        task.startTime.getTime(),
        task.endTime?.getTime() || null,
        task.containerId || null,
        task.result ? JSON.stringify(task.result) : null,
        task.error || null,
        task.progress || null,
        task.sessionId || null,
        task.pendingQuestion || null
      );
      
      logger.debug('Saved background task', { taskId: task.id, status: task.status });
    } catch (error) {
      logger.error('Failed to save background task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getBackgroundTask(taskId: string): Promise<BackgroundTask | undefined> {
    const stmt = this.db.prepare('SELECT * FROM background_tasks WHERE id = ?');
    const row = stmt.get(taskId) as PersistedBackgroundTask | undefined;
    
    if (!row) return undefined;
    
    return this.rowToBackgroundTask(row);
  }

  async getIncompleteTasks(): Promise<BackgroundTask[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM background_tasks WHERE status IN (?, ?) ORDER BY start_time DESC'
    );
    const rows = stmt.all('running', 'started') as PersistedBackgroundTask[];
    
    return rows.map(row => this.rowToBackgroundTask(row));
  }

  private rowToBackgroundTask(row: PersistedBackgroundTask): BackgroundTask {
    return {
      id: row.id,
      args: JSON.parse(row.args),
      status: row.status as any,
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      containerId: row.container_id || undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      progress: row.progress || undefined,
      sessionId: row.session_id || undefined,
      pendingQuestion: row.pending_question || undefined
    };
  }

  // Git diff methods
  async saveGitDiff(diff: GitDiff): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO git_diffs 
      (id, container_id, created_at, workspace_path, files_changed, additions, deletions, diff_content, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    try {
      stmt.run(
        diff.id,
        diff.containerId,
        Date.now(),
        diff.workspace || '',
        diff.stats.filesChanged,
        diff.stats.additions,
        diff.stats.deletions,
        JSON.stringify(diff),
        'pending'
      );
      
      logger.debug('Saved git diff', { diffId: diff.id, filesChanged: diff.stats.filesChanged });
    } catch (error) {
      logger.error('Failed to save git diff', {
        diffId: diff.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getGitDiff(diffId: string): Promise<GitDiff | undefined> {
    const stmt = this.db.prepare('SELECT * FROM git_diffs WHERE id = ?');
    const row = stmt.get(diffId) as PersistedGitDiff | undefined;
    
    if (!row) return undefined;
    
    return this.rowToGitDiff(row);
  }

  async getPendingDiffs(): Promise<GitDiff[]> {
    const stmt = this.db.prepare('SELECT * FROM git_diffs WHERE status = ? ORDER BY created_at DESC');
    const rows = stmt.all('pending') as PersistedGitDiff[];
    
    return rows.map(row => this.rowToGitDiff(row));
  }

  async updateDiffStatus(diffId: string, status: 'applied' | 'rejected', appliedTo?: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE git_diffs 
      SET status = ?, applied_at = ?, applied_to = ?
      WHERE id = ?
    `);
    
    stmt.run(
      status,
      status === 'applied' ? Date.now() : null,
      appliedTo || null,
      diffId
    );
    
    logger.debug('Updated diff status', { diffId, status });
  }

  private rowToGitDiff(row: PersistedGitDiff): GitDiff {
    // Try to parse stored JSON, fallback to basic structure
    try {
      const parsed = JSON.parse(row.diff_content);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp)
      };
    } catch {
      // Fallback for old format
      return {
        id: row.id,
        containerId: row.container_id,
        workspace: row.workspace_path,
        patch: '',
        summary: '',
        stats: {
          filesChanged: row.files_changed,
          additions: row.additions,
          deletions: row.deletions
        },
        files: [],
        timestamp: new Date(row.created_at)
      };
    }
  }

  // Container methods
  async saveContainer(container: PersistedContainer): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO containers 
      (id, name, task_id, status, created_at, last_used, auth_configured, workspace_configured, workspace_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      container.id,
      container.name,
      container.task_id || null,
      container.status,
      container.created_at,
      container.last_used || null,
      container.auth_configured ? 1 : 0,
      container.workspace_configured ? 1 : 0,
      container.workspace_path || null
    );
  }

  async getContainerById(containerId: string): Promise<PersistedContainer | undefined> {
    const stmt = this.db.prepare('SELECT * FROM containers WHERE id = ?');
    const row = stmt.get(containerId) as PersistedContainer | undefined;
    
    return row || undefined;
  }

  async getActiveContainers(): Promise<PersistedContainer[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM containers WHERE status IN (?, ?, ?) ORDER BY created_at DESC'
    );
    return stmt.all('creating', 'ready', 'in-use') as PersistedContainer[];
  }

  // Log reference methods
  async saveLogReference(taskId: string | null, containerId: string, logFilePath: string, sizeBytes: number): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO execution_logs (task_id, container_id, log_file_path, created_at, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(taskId, containerId, logFilePath, Date.now(), sizeBytes);
  }

  // Cleanup methods
  async cleanupOldData(olderThanMs: number): Promise<void> {
    const cutoffTime = Date.now() - olderThanMs;
    
    logger.info('Cleaning up old data', { cutoffTime: new Date(cutoffTime) });
    
    // Clean up old completed tasks
    const taskStmt = this.db.prepare(
      'DELETE FROM background_tasks WHERE status IN (?, ?) AND end_time < ?'
    );
    const taskResult = taskStmt.run('completed', 'failed', cutoffTime);
    
    // Clean up old applied/rejected diffs
    const diffStmt = this.db.prepare(
      'DELETE FROM git_diffs WHERE status IN (?, ?) AND applied_at < ?'
    );
    const diffResult = diffStmt.run('applied', 'rejected', cutoffTime);
    
    logger.info('Cleanup completed', {
      tasksDeleted: taskResult.changes,
      diffsDeleted: diffResult.changes
    });
  }

  // Close database connection
  close(): void {
    logger.info('Closing database connection');
    this.db.close();
  }
}