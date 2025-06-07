/**
 * Startup Recovery Manager
 * Handles recovery of interrupted tasks and orphaned containers on server restart
 */

import Docker from 'dockerode';
import { logger } from '../utils/logger.js';
import { PersistenceManager } from '../persistence/database.js';
import type { BackgroundTask } from '../tools/claude-code-git-integrated.js';

export class StartupRecoveryManager {
  private docker: Docker;
  private persistence: PersistenceManager;
  
  constructor(docker: Docker, persistence: PersistenceManager) {
    this.docker = docker;
    this.persistence = persistence;
  }

  /**
   * Perform full recovery process on startup
   */
  async recoverOnStartup(): Promise<void> {
    logger.info('Starting recovery process...');
    
    try {
      // 1. Check for running containers
      await this.recoverContainers();
      
      // 2. Check for interrupted tasks
      await this.recoverInterruptedTasks();
      
      // 3. Clean up stale data
      await this.cleanupStaleData();
      
      logger.info('Recovery process completed successfully');
    } catch (error) {
      logger.error('Recovery process failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      // Don't throw - allow server to start even if recovery fails
    }
  }

  /**
   * Recover or cleanup orphaned containers
   */
  private async recoverContainers(): Promise<void> {
    logger.info('Checking for orphaned containers...');
    
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: ['claude-parallel=true'] }
      });
      
      logger.info(`Found ${containers.length} claude-parallel containers`);
      
      for (const containerInfo of containers) {
        const containerId = containerInfo.Id;
        const containerName = containerInfo.Names[0]?.replace('/', '') || 'unknown';
        const taskId = containerInfo.Labels['task-id'] || undefined;
        
        // Check database for container record
        const dbRecord = await this.persistence.getContainerById(containerId);
        
        if (!dbRecord) {
          logger.warn(`Found orphaned container: ${containerName}`, {
            containerId,
            taskId,
            state: containerInfo.State,
            status: containerInfo.Status
          });
          
          // Check if container is old (more than 1 hour)
          const createdMs = containerInfo.Created * 1000;
          const ageMs = Date.now() - createdMs;
          const oneHourMs = 60 * 60 * 1000;
          
          if (ageMs > oneHourMs && containerInfo.State !== 'running') {
            logger.info(`Removing old orphaned container: ${containerName}`);
            try {
              const container = this.docker.getContainer(containerId);
              await container.remove({ force: true });
            } catch (error) {
              logger.error(`Failed to remove container ${containerName}`, {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          } else if (containerInfo.State === 'running') {
            // Running container without DB record - save it
            logger.info(`Adopting running orphaned container: ${containerName}`);
            await this.persistence.saveContainer({
              id: containerId,
              name: containerName,
              task_id: taskId,
              status: 'in-use',
              created_at: createdMs,
              last_used: Date.now(),
              auth_configured: true,
              workspace_configured: true
            });
          }
        } else {
          // Container has DB record - update last used time if running
          if (containerInfo.State === 'running') {
            await this.persistence.saveContainer({
              ...dbRecord,
              last_used: Date.now()
            });
          }
        }
      }
    } catch (error) {
      logger.error('Container recovery failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Recover interrupted background tasks
   */
  private async recoverInterruptedTasks(): Promise<void> {
    logger.info('Checking for interrupted tasks...');
    
    try {
      const incompleteTasks = await this.persistence.getIncompleteTasks();
      
      logger.info(`Found ${incompleteTasks.length} incomplete tasks`);
      
      for (const task of incompleteTasks) {
        logger.warn(`Found interrupted task: ${task.id}`, {
          status: task.status,
          startTime: task.startTime,
          containerId: task.containerId
        });
        
        // Check if container still exists
        let containerExists = false;
        if (task.containerId) {
          try {
            const container = this.docker.getContainer(task.containerId);
            const info = await container.inspect();
            containerExists = info.State.Running;
          } catch (error) {
            // Container doesn't exist
            containerExists = false;
          }
        }
        
        if (!containerExists) {
          // Mark task as failed
          logger.info(`Marking interrupted task as failed: ${task.id}`);
          await this.persistence.saveBackgroundTask({
            ...task,
            status: 'failed',
            endTime: new Date(),
            error: 'Task interrupted by server restart',
            progress: 'Task was interrupted when the server restarted'
          });
        } else {
          logger.info(`Task ${task.id} has running container, keeping as active`);
          // TODO: Could attempt to reconnect to the container and monitor it
        }
      }
    } catch (error) {
      logger.error('Task recovery failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Clean up old data
   */
  private async cleanupStaleData(): Promise<void> {
    logger.info('Cleaning up stale data...');
    
    try {
      // Clean up data older than 7 days
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      await this.persistence.cleanupOldData(sevenDaysMs);
      
      // Check for pending diffs without containers
      const pendingDiffs = await this.persistence.getPendingDiffs();
      
      for (const diff of pendingDiffs) {
        try {
          const container = this.docker.getContainer(diff.containerId);
          await container.inspect();
        } catch (error) {
          // Container doesn't exist - mark diff as rejected
          logger.info(`Rejecting diff for non-existent container: ${diff.id}`);
          await this.persistence.updateDiffStatus(diff.id, 'rejected');
        }
      }
    } catch (error) {
      logger.error('Cleanup failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}