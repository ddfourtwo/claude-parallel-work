/**
 * Git Container Diff Manager
 * 
 * Manages Git-based change tracking inside Docker containers.
 * This replaces the complex worktree-based approach with a simpler
 * Git-inside-container solution.
 */

import Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { 
  GitDiff, 
  GitDiffFile, 
  GitDiffStats, 
  GitInitOptions, 
  GitDiffOptions,
  GitDiffExtractResult 
} from '../types/git-diff-types.js';
import { logger } from '../utils/logger.js';

export class GitContainerDiffManager {
  private docker: Docker;
  private defaultGitConfig = {
    userEmail: 'claude@container.local',
    userName: 'Claude Container',
    safeDirs: ['/workspace']
  };

  constructor(docker: Docker) {
    this.docker = docker;
  }

  /**
   * Initialize Git tracking inside a container
   */
  async initializeGitTracking(
    container: Docker.Container, 
    options?: GitInitOptions
  ): Promise<void> {
    const config = { ...this.defaultGitConfig, ...options };
    
    logger.debug('Initializing Git tracking in container');

    // Build the initialization script
    const initScript = `
#!/bin/bash
set -e

cd /workspace

# Configure Git with safe settings
git config --global user.email "${config.userEmail}"
git config --global user.name "${config.userName}"
git config --global init.defaultBranch main

# Add safe directories
${config.safeDirs?.map(dir => `git config --global --add safe.directory ${dir}`).join('\n')}

# Initialize repository if not already initialized
if [ ! -d .git ]; then
  git init
  echo "[GitDiff] Git repository initialized"
else
  echo "[GitDiff] Git repository already exists"
fi

# Stage and commit initial state
git add -A || true

# Check if we have any commits
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  # HEAD exists, check for changes
  if ! git diff --cached --quiet HEAD; then
    git commit -m "Initial container state" || true
    echo "[GitDiff] Initial commit created"
  else
    echo "[GitDiff] No changes to commit initially"
  fi
else
  # No HEAD yet, we need an initial commit even if empty
  # This ensures HEAD exists for future diffs
  git commit --allow-empty -m "Initial container state (empty)" || true
  echo "[GitDiff] Created initial empty commit to establish HEAD"
fi

# Show status
git status --short
`;

    await this.execInContainer(container, ['bash', '-c', initScript]);
  }

  /**
   * Extract diff from container
   */
  async extractDiff(
    container: Docker.Container,
    options?: GitDiffOptions
  ): Promise<GitDiffExtractResult> {
    const diffId = uuidv4();
    const logs: string[] = [];

    try {
      logger.debug('Extracting changes from container');

      // Force git index refresh to detect file changes
      try {
        await this.execInContainer(container, ['git', 'update-index', '--refresh'], '/workspace');
      } catch (refreshError) {
        // Some files might have permission issues, but we can continue
        logger.debug('Git index refresh warning (non-critical)', { error: refreshError });
      }

      // First, stage all changes
      await this.execInContainer(container, ['git', 'add', '-A'], '/workspace');

      // Check if there are any changes
      const hasChanges = await this.hasChanges(container);
      if (!hasChanges) {
        logs.push('No changes detected in container');
        return {
          success: true,
          diff: {
            id: diffId,
            containerId: container.id,
            patch: '',
            summary: 'No changes',
            files: [],
            stats: { filesChanged: 0, additions: 0, deletions: 0 },
            timestamp: new Date()
          },
          logs
        };
      }

      // Extract various diff formats
      const [patch, stats, files, summary] = await Promise.all([
        this.extractPatch(container, options),
        this.extractStats(container),
        this.extractFileList(container),
        this.extractSummary(container)
      ]);

      // Parse the stats
      const parsedStats = this.parseStats(stats);
      const parsedFiles = this.parseFileList(files, summary);

      // Handle binary files if requested
      let binaryFiles: string[] = [];
      if (options?.includeBinary) {
        binaryFiles = await this.extractBinaryFiles(container);
      }

      const diff: GitDiff = {
        id: diffId,
        containerId: container.id.substring(0, 12),
        patch,
        summary: summary.trim(),
        files: parsedFiles,
        stats: parsedStats,
        timestamp: new Date(),
        binaryFiles: binaryFiles.length > 0 ? binaryFiles : undefined
      };

      logs.push(`Successfully extracted diff with ${diff.stats.filesChanged} files changed`);
      return { success: true, diff, logs };

    } catch (error: any) {
      logger.error('Error extracting diff', { error: error instanceof Error ? error.message : String(error) });
      logs.push(`Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs
      };
    }
  }

  /**
   * Apply a diff to a target directory
   */
  async applyDiff(diff: GitDiff, targetPath: string): Promise<boolean> {
    if (!diff.patch || diff.patch.trim() === '') {
      logger.debug('No changes to apply');
      return true;
    }

    // This would be implemented to apply the patch
    // For now, we'll use this in conjunction with the existing apply mechanisms
    logger.debug('Would apply diff', { diffId: diff.id, targetPath });
    return true;
  }

  /**
   * Execute a command in the container and return output
   */
  private async execInContainer(
    container: Docker.Container,
    cmd: string[],
    workDir: string = '/workspace'
  ): Promise<string> {
    const exec = await container.exec({
      Cmd: cmd,
      WorkingDir: workDir,
      AttachStdout: true,
      AttachStderr: true,
      User: 'node'
    });

    const stream = await exec.start({ hijack: true });
    
    return new Promise((resolve, reject) => {
      let output = '';
      let error = '';

      stream.on('data', (chunk: Buffer) => {
        const str = chunk.toString();
        // Docker multiplexes stdout/stderr in the stream
        // First byte indicates stream type: 1=stdout, 2=stderr
        if (chunk[0] === 1) {
          output += str.substring(8); // Skip the 8-byte header
        } else if (chunk[0] === 2) {
          error += str.substring(8);
        } else {
          // No header, raw output
          output += str;
        }
      });

      stream.on('end', async () => {
        try {
          const execInfo = await exec.inspect();
          if (execInfo.ExitCode !== 0) {
            reject(new Error(`Command exited with code ${execInfo.ExitCode}: ${error || 'No output'}`));
          } else {
            resolve(output);
          }
        } catch (inspectError) {
          reject(new Error(`Failed to inspect exec: ${inspectError}`));
        }
      });

      stream.on('error', reject);
    });
  }

  /**
   * Check if there are any staged changes
   */
  private async hasChanges(container: Docker.Container): Promise<boolean> {
    try {
      // First check if HEAD exists
      try {
        await this.execInContainer(container, ['git', 'rev-parse', '--verify', 'HEAD']);
        // HEAD exists, check for changes against it
        await this.execInContainer(container, ['git', 'diff', '--cached', '--quiet', 'HEAD']);
        return false; // No changes (command succeeded)
      } catch {
        // Either HEAD doesn't exist or there are changes
        // Check if there are any staged files
        const output = await this.execInContainer(container, ['git', 'ls-files', '--cached']);
        return output.trim().length > 0;
      }
    } catch {
      return true; // Has changes (command failed)
    }
  }

  /**
   * Extract the patch
   */
  private async extractPatch(
    container: Docker.Container,
    options?: GitDiffOptions
  ): Promise<string> {
    // Check if HEAD exists
    let hasHead = false;
    try {
      await this.execInContainer(container, ['git', 'rev-parse', '--verify', 'HEAD']);
      hasHead = true;
    } catch {
      hasHead = false;
    }

    let args: string[];
    if (hasHead) {
      // Normal diff against HEAD
      args = ['git', 'diff', '--cached', 'HEAD'];
    } else {
      // No HEAD yet, show all staged files as new
      args = ['git', 'diff', '--cached'];
    }
    
    if (options?.contextLines !== undefined) {
      args.push(`--unified=${options.contextLines}`);
    }
    if (options?.ignoreWhitespace) {
      args.push('--ignore-all-space');
    }
    if (options?.includeBinary) {
      args.push('--binary');
    }

    return this.execInContainer(container, args);
  }

  /**
   * Extract statistics
   */
  private async extractStats(container: Docker.Container): Promise<string> {
    // Check if HEAD exists
    let hasHead = false;
    try {
      await this.execInContainer(container, ['git', 'rev-parse', '--verify', 'HEAD']);
      hasHead = true;
    } catch {
      hasHead = false;
    }

    if (hasHead) {
      return this.execInContainer(container, ['git', 'diff', '--cached', '--shortstat', 'HEAD']);
    } else {
      // No HEAD yet, count all staged files
      const output = await this.execInContainer(container, ['git', 'ls-files', '--cached']);
      const files = output.trim().split('\n').filter(f => f.length > 0);
      return `${files.length} files added`;
    }
  }

  /**
   * Extract file list
   */
  private async extractFileList(container: Docker.Container): Promise<string> {
    // Check if HEAD exists
    let hasHead = false;
    try {
      await this.execInContainer(container, ['git', 'rev-parse', '--verify', 'HEAD']);
      hasHead = true;
    } catch {
      hasHead = false;
    }

    if (hasHead) {
      return this.execInContainer(container, ['git', 'diff', '--cached', '--name-status', 'HEAD']);
    } else {
      // No HEAD yet, all files are new
      const output = await this.execInContainer(container, ['git', 'ls-files', '--cached']);
      return output.trim().split('\n').filter(f => f.length > 0).map(f => `A\t${f}`).join('\n');
    }
  }

  /**
   * Extract summary
   */
  private async extractSummary(container: Docker.Container): Promise<string> {
    // Check if HEAD exists
    let hasHead = false;
    try {
      await this.execInContainer(container, ['git', 'rev-parse', '--verify', 'HEAD']);
      hasHead = true;
    } catch {
      hasHead = false;
    }

    if (hasHead) {
      return this.execInContainer(container, ['git', 'diff', '--cached', '--stat', 'HEAD']);
    } else {
      // No HEAD yet, show all files as new
      return this.execInContainer(container, ['git', 'ls-files', '--cached']);
    }
  }

  /**
   * Extract binary files
   */
  private async extractBinaryFiles(container: Docker.Container): Promise<string[]> {
    try {
      const output = await this.execInContainer(container, [
        'git', 'diff', '--cached', '--name-only', '--diff-filter=A', 'HEAD'
      ]);
      
      // Check each file to see if it's binary
      const files = output.trim().split('\n').filter(f => f);
      const binaryFiles: string[] = [];

      for (const file of files) {
        try {
          await this.execInContainer(container, ['file', '-b', '--mime-type', file]);
          // For now, we'll mark common binary extensions
          if (file.match(/\.(png|jpg|jpeg|gif|pdf|zip|tar|gz|exe|dll|so)$/i)) {
            binaryFiles.push(file);
          }
        } catch {
          // Ignore errors checking individual files
        }
      }

      return binaryFiles;
    } catch {
      return [];
    }
  }

  /**
   * Parse stats output
   */
  private parseStats(statsOutput: string): GitDiffStats {
    // Example: " 3 files changed, 10 insertions(+), 2 deletions(-)"
    const match = statsOutput.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    
    if (match) {
      return {
        filesChanged: parseInt(match[1], 10) || 0,
        additions: parseInt(match[2], 10) || 0,
        deletions: parseInt(match[3], 10) || 0
      };
    }

    return { filesChanged: 0, additions: 0, deletions: 0 };
  }

  /**
   * Parse file list output
   */
  private parseFileList(nameStatus: string, statOutput: string): GitDiffFile[] {
    const files: GitDiffFile[] = [];
    const lines = nameStatus.trim().split('\n').filter(line => line);

    // Parse name-status output (e.g., "M file.txt", "A new.txt", "D old.txt")
    const statusMap: Record<string, GitDiffFile['status']> = {
      'M': 'modified',
      'A': 'added',
      'D': 'deleted',
      'R': 'renamed'
    };

    for (const line of lines) {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      
      if (status && path && statusMap[status]) {
        const file: GitDiffFile = {
          path,
          status: statusMap[status]
        };

        // For renamed files, path format is "old -> new"
        if (status === 'R' && path.includes(' -> ')) {
          const [oldPath, newPath] = path.split(' -> ');
          file.oldPath = oldPath;
          file.path = newPath;
        }

        files.push(file);
      }
    }

    // Parse stat output to get additions/deletions per file
    const statLines = statOutput.trim().split('\n');
    for (const statLine of statLines) {
      // Example: " file.txt | 5 +++--"
      const match = statLine.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([\+\-]+)?/);
      if (match) {
        const [, filepath, changes] = match;
        const file = files.find(f => f.path === filepath.trim());
        if (file && match[3]) {
          file.additions = (match[3].match(/\+/g) || []).length;
          file.deletions = (match[3].match(/-/g) || []).length;
        }
      }
    }

    return files;
  }

  /**
   * Clean up Git repository in container before removal
   */
  async cleanup(container: Docker.Container): Promise<void> {
    try {
      logger.debug('Cleaning up Git repository');
      await this.execInContainer(container, ['rm', '-rf', '.git'], '/workspace');
    } catch (error) {
      // Ignore cleanup errors
      logger.debug('Cleanup error (non-critical)', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}