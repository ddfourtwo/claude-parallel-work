/**
 * Container Lifecycle Manager
 * 
 * Manages container states: running → stopped → removed
 * Provides TTL-based cleanup and diff extraction
 */

import Docker from 'dockerode';
import { Container } from 'dockerode';
import { debugLog } from '../tools/debug.js';
import * as fs from 'fs';

export interface ContainerInfo {
  container: Container;
  workFolder: string;
  createdAt: Date;
  stoppedAt?: Date;
  status: 'running' | 'stopped' | 'pending_review' | 'applied' | 'rejected';
  cachedDiff?: ContainerDiff;
  tempDir?: string;
  ttlTimeout?: NodeJS.Timeout;
}

export interface ContainerDiff {
  containerId: string;
  changes: Array<{ Path: string; Kind: number }>;
  additions: number;
  deletions: number;
  modifications: number;
  patch?: string;
}

export class ContainerLifecycleManager {
  private docker: Docker;
  private containers: Map<string, ContainerInfo> = new Map();
  private readonly TTL_HOURS = 1;

  constructor(docker: Docker) {
    this.docker = docker;
  }

  /**
   * Register a new container for lifecycle management
   */
  registerContainer(
    container: Container, 
    workFolder: string
  ): string {
    const containerId = container.id.substring(0, 12);
    
    const info: ContainerInfo = {
      container,
      workFolder,
      createdAt: new Date(),
      status: 'running'
    };
    
    this.containers.set(containerId, info);
    debugLog(`Registered container ${containerId} for lifecycle management`);
    
    return containerId;
  }

  /**
   * Stop a container but preserve it for diff extraction
   */
  async stopContainer(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new Error(`Container ${containerId} not found in lifecycle manager`);
    }

    try {
      await info.container.stop();
      info.status = 'pending_review';
      info.stoppedAt = new Date();
      
      // Start TTL countdown
      this.startTTLTimer(containerId);
      
      debugLog(`Container ${containerId} stopped and awaiting review`);
    } catch (error: any) {
      if (error.statusCode === 304) {
        // Container already stopped
        debugLog(`Container ${containerId} was already stopped`);
        info.status = 'pending_review';
        info.stoppedAt = new Date();
        this.startTTLTimer(containerId);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get container changes using Docker diff API
   */
  async getContainerDiff(containerId: string): Promise<ContainerDiff> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new Error(`Container ${containerId} not found`);
    }

    // Use cached diff if available
    if (info.cachedDiff) {
      return info.cachedDiff;
    }

    try {
      // Get changes from Docker
      const changes = await info.container.changes();
      
      // Count change types
      let additions = 0;
      let deletions = 0; 
      let modifications = 0;

      changes.forEach((change: { Path: string; Kind: number }) => {
        // Filter to only workspace changes
        if (change.Path.startsWith('/workspace/')) {
          switch (change.Kind) {
            case 0: deletions++; break;
            case 1: additions++; break;
            case 2: modifications++; break;
          }
        }
      });

      const diff: ContainerDiff = {
        containerId,
        changes: changes.filter((c: { Path: string; Kind: number }) => c.Path.startsWith('/workspace/')),
        additions,
        deletions,
        modifications
      };

      // Cache the diff
      info.cachedDiff = diff;
      
      debugLog(`Container ${containerId} diff: +${additions} -${deletions} ~${modifications}`);
      return diff;
    } catch (error) {
      debugLog(`Failed to get diff for container ${containerId}:`, error);
      throw new Error(`Failed to get container diff: ${error}`);
    }
  }

  /**
   * Mark container as applied and schedule removal
   */
  async markApplied(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new Error(`Container ${containerId} not found`);
    }

    info.status = 'applied';
    
    // Cancel TTL timer
    if (info.ttlTimeout) {
      clearTimeout(info.ttlTimeout);
    }

    // Remove container
    await this.removeContainer(containerId);
  }

  /**
   * Mark container as rejected and schedule removal
   */
  async markRejected(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) {
      throw new Error(`Container ${containerId} not found`);
    }

    info.status = 'rejected';
    
    // Cancel TTL timer
    if (info.ttlTimeout) {
      clearTimeout(info.ttlTimeout);
    }

    // Remove container
    await this.removeContainer(containerId);
  }

  /**
   * Remove a container and cleanup
   */
  private async removeContainer(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) return;

    try {
      // Force remove the container
      await info.container.remove({ force: true });
      debugLog(`Container ${containerId} removed`);
    } catch (error: any) {
      if (error.statusCode !== 404) {
        debugLog(`Failed to remove container ${containerId}:`, error);
      }
    }

    // Remove from tracking
    this.containers.delete(containerId);
  }

  /**
   * Start TTL timer for automatic cleanup
   */
  private startTTLTimer(containerId: string): void {
    const info = this.containers.get(containerId);
    if (!info) return;

    // Clear existing timer if any
    if (info.ttlTimeout) {
      clearTimeout(info.ttlTimeout);
    }

    // Set new timer
    info.ttlTimeout = setTimeout(
      () => this.handleTTLExpiry(containerId),
      this.TTL_HOURS * 60 * 60 * 1000
    );

    debugLog(`TTL timer started for container ${containerId} (${this.TTL_HOURS} hour)`);
  }

  /**
   * Handle TTL expiry
   */
  private async handleTTLExpiry(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) return;

    if (info.status === 'pending_review') {
      debugLog(`Container ${containerId} TTL expired, removing...`);
      await this.removeContainer(containerId);
    }
  }

  /**
   * Get container info
   */
  getContainerInfo(containerId: string): ContainerInfo | undefined {
    return this.containers.get(containerId);
  }

  /**
   * List all managed containers
   */
  listContainers(): Array<{
    id: string;
    status: string;
    age: number;
    workFolder: string;
  }> {
    const now = Date.now();
    return Array.from(this.containers.entries()).map(([id, info]) => ({
      id,
      status: info.status,
      age: Math.floor((now - info.createdAt.getTime()) / 1000), // seconds
      workFolder: info.workFolder
    }));
  }

  /**
   * Cleanup all containers (for shutdown)
   */
  async cleanupAll(): Promise<void> {
    debugLog(`Cleaning up ${this.containers.size} managed containers...`);
    
    const promises = Array.from(this.containers.keys()).map(id =>
      this.removeContainer(id).catch(err => 
        debugLog(`Failed to cleanup container ${id}:`, err)
      )
    );

    await Promise.all(promises);
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    running: number;
    stopped: number;
    pendingReview: number;
  } {
    let running = 0;
    let stopped = 0;
    let pendingReview = 0;

    this.containers.forEach(info => {
      switch (info.status) {
        case 'running': running++; break;
        case 'stopped': stopped++; break;
        case 'pending_review': pendingReview++; break;
      }
    });

    return {
      total: this.containers.size,
      running,
      stopped,
      pendingReview
    };
  }

  /**
   * Cleanup diff containers (can target specific diff or all)
   */
  async cleanupDiffContainers(diffId?: string): Promise<void> {
    if (diffId) {
      // For now, just cleanup all - could be enhanced to track diff-to-container mapping
      debugLog(`Cleanup requested for diff ${diffId}`);
    }
    return this.cleanupAll();
  }

  /**
   * Cleanup old containers (alias for cleanupAll)
   */
  async cleanup(maxAgeHours?: number): Promise<void> {
    // For now, just cleanup all
    return this.cleanupAll();
  }

  /**
   * Get status (alias for getStats)
   */
  getStatus(): any {
    return this.getStats();
  }

  /**
   * Start monitoring (no-op for now)
   */
  startMonitoring(): void {
    // No-op - monitoring is automatic
    debugLog('Container monitoring is automatic');
  }

  /**
   * Stop monitoring (no-op for now)
   */
  stopMonitoring(): void {
    // No-op - monitoring is automatic
    debugLog('Container monitoring is automatic');
  }
}