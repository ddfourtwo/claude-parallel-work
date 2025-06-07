/**
 * Git Diff Integration
 * 
 * Provides high-level integration between Git-based diff tracking
 * and the execution flow, replacing the old worktree approach.
 */

import Docker from 'dockerode';
import { GitContainerDiffManager } from './git-container-diff-manager.js';
import { GitDiff, GitDiffExtractResult } from '../types/git-diff-types.js';
import { debugLog } from './debug.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PersistenceManager } from '../persistence/database.js';
import { logger } from '../utils/logger.js';

export interface DiffApplyOptions {
  dryRun?: boolean;
  backup?: boolean;
}

export class GitDiffIntegration {
  private docker: Docker;
  private gitDiffManager: GitContainerDiffManager;
  private diffStorage: Map<string, GitDiff> = new Map();
  private persistence?: PersistenceManager;

  constructor(docker: Docker, persistence?: PersistenceManager) {
    this.docker = docker;
    this.gitDiffManager = new GitContainerDiffManager(docker);
    this.persistence = persistence;
  }

  /**
   * Initialize Git tracking for a container
   */
  async initializeTracking(container: Docker.Container): Promise<void> {
    await this.gitDiffManager.initializeGitTracking(container);
  }

  /**
   * Extract and store diff from container
   */
  async extractAndStoreDiff(
    container: Docker.Container,
    workFolder: string
  ): Promise<GitDiffExtractResult> {
    const result = await this.gitDiffManager.extractDiff(container);
    
    if (result.success && result.diff) {
      // Add workspace path to diff
      result.diff.workspace = workFolder;
      
      // Store the diff in memory
      this.diffStorage.set(result.diff.id, result.diff);
      debugLog(`Stored Git diff ${result.diff.id} for workspace ${workFolder}`);
      
      // Persist if available
      if (this.persistence && result.diff.stats.filesChanged > 0) {
        try {
          await this.persistence.saveGitDiff(result.diff);
          logger.debug('Persisted git diff', { diffId: result.diff.id });
        } catch (error) {
          logger.error('Failed to persist git diff', {
            diffId: result.diff.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return result;
  }

  /**
   * Get stored diff by ID
   */
  async getDiff(diffId: string): Promise<GitDiff | undefined> {
    // Check memory first
    let diff = this.diffStorage.get(diffId);
    
    // If not in memory and we have persistence, check database
    if (!diff && this.persistence) {
      try {
        const persistedDiff = await this.persistence.getGitDiff(diffId);
        if (persistedDiff) {
          // Add back to memory cache
          this.diffStorage.set(diffId, persistedDiff);
          diff = persistedDiff;
        }
      } catch (error) {
        logger.error('Failed to retrieve diff from persistence', {
          diffId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return diff;
  }

  /**
   * Format diff for human review
   */
  formatDiffForReview(diff: GitDiff): string {
    let output = `## Change Summary\n\n`;
    output += `**Diff ID:** ${diff.id}\n`;
    output += `**Container:** ${diff.containerId}\n`;
    output += `**Timestamp:** ${diff.timestamp.toISOString()}\n\n`;
    
    output += `### Statistics\n`;
    output += `- Files changed: ${diff.stats.filesChanged}\n`;
    output += `- Additions: ${diff.stats.additions} lines\n`;
    output += `- Deletions: ${diff.stats.deletions} lines\n\n`;
    
    output += `### File Changes\n\n`;
    for (const file of diff.files) {
      const icon = file.status === 'added' ? '➕' : 
                   file.status === 'deleted' ? '➖' : 
                   file.status === 'modified' ? '📝' : '🔄';
      output += `${icon} ${file.path}`;
      
      if (file.status === 'renamed' && file.oldPath) {
        output += ` (renamed from ${file.oldPath})`;
      }
      
      if (file.additions || file.deletions) {
        output += ` (+${file.additions || 0}, -${file.deletions || 0})`;
      }
      
      output += '\n';
    }
    
    if (diff.binaryFiles && diff.binaryFiles.length > 0) {
      output += `\n### Binary Files\n\n`;
      for (const file of diff.binaryFiles) {
        output += `🔒 ${file}\n`;
      }
    }
    
    if (diff.patch) {
      output += `\n### Patch\n\n\`\`\`diff\n${diff.patch}\n\`\`\`\n`;
    }
    
    return output;
  }

  /**
   * Apply a diff to the workspace
   */
  async applyDiff(
    diffId: string, 
    targetWorkspace: string,
    options: DiffApplyOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    const diff = await this.getDiff(diffId);
    if (!diff) {
      return { 
        success: false, 
        error: `Diff ${diffId} not found` 
      };
    }

    if (!diff.patch || diff.patch.trim() === '') {
      return { 
        success: true, 
        error: 'No changes to apply' 
      };
    }

    try {
      // Create backup if requested
      if (options.backup) {
        const backupPath = `${targetWorkspace}.backup-${Date.now()}`;
        await this.createBackup(targetWorkspace, backupPath);
        debugLog(`Created backup at ${backupPath}`);
      }

      // Save patch to temporary file
      const tempPatchFile = path.join('/tmp', `git-diff-${diffId}.patch`);
      await fs.writeFile(tempPatchFile, diff.patch);

      // Apply the patch using git apply
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const applyCommand = options.dryRun ?
        `git apply --check "${tempPatchFile}"` :
        `git apply "${tempPatchFile}"`;

      try {
        const { stdout, stderr } = await execAsync(applyCommand, {
          cwd: targetWorkspace,
          maxBuffer: 10 * 1024 * 1024 // 10MB
        });

        if (stderr && !stderr.includes('warning:')) {
          throw new Error(`Patch application stderr: ${stderr}`);
        }

        debugLog(`Successfully applied diff ${diffId} to ${targetWorkspace}`);
        
        // Update persistence if available
        if (this.persistence) {
          try {
            await this.persistence.updateDiffStatus(diffId, 'applied', targetWorkspace);
          } catch (error) {
            logger.error('Failed to update diff status in persistence', {
              diffId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        
        // Clean up temp file
        await fs.unlink(tempPatchFile).catch(() => {});
        
        return { success: true };

      } catch (applyError: any) {
        // Try alternative patch application methods
        debugLog('Git apply failed, trying patch command...');
        
        try {
          const { stdout, stderr } = await execAsync(
            `patch -p1 < "${tempPatchFile}"`,
            { cwd: targetWorkspace }
          );

          if (stderr && !stderr.includes('succeeded')) {
            throw new Error(`Patch command stderr: ${stderr}`);
          }

          return { success: true };

        } catch (patchError: any) {
          // Clean up temp file
          await fs.unlink(tempPatchFile).catch(() => {});
          
          return {
            success: false,
            error: `Failed to apply patch: ${applyError.message || patchError.message}`
          };
        }
      }

    } catch (error: any) {
      return {
        success: false,
        error: `Diff application failed: ${error.message}`
      };
    }
  }

  /**
   * Create a backup of the workspace
   */
  private async createBackup(source: string, destination: string): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync(`cp -r "${source}" "${destination}"`);
  }

  /**
   * Clean up old diffs
   */
  async cleanup(olderThanHours: number = 24): Promise<void> {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    const toDelete: string[] = [];

    this.diffStorage.forEach((diff, id) => {
      if (diff.timestamp.getTime() < cutoff) {
        toDelete.push(id);
      }
    });

    for (const id of toDelete) {
      this.diffStorage.delete(id);
    }

    debugLog(`Cleaned up ${toDelete.length} old diffs`);
  }

  /**
   * Get all stored diffs
   */
  getAllDiffs(): GitDiff[] {
    return Array.from(this.diffStorage.values());
  }

  /**
   * Export diff to file
   */
  async exportDiff(diffId: string, outputPath: string): Promise<void> {
    const diff = await this.getDiff(diffId);
    if (!diff) {
      throw new Error(`Diff ${diffId} not found`);
    }

    await fs.writeFile(outputPath, JSON.stringify(diff, null, 2));
    debugLog(`Exported diff ${diffId} to ${outputPath}`);
  }
}