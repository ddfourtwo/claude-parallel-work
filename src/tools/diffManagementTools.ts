/**
 * Diff Management Tools
 * 
 * Provides high-level diff management operations for the enhanced server
 * using the Git-integrated execution approach.
 */

import { GitIntegratedClaudeCodeManager } from './claude-code-git-integrated.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { RevisionRequest } from '../types/git-diff-types.js';

export class DiffManagementTools {
  private codeManager: GitIntegratedClaudeCodeManager;

  constructor(codeManager: GitIntegratedClaudeCodeManager) {
    this.codeManager = codeManager;
  }

  /**
   * Review pending diffs
   */
  async reviewPendingDiffs(args: { 
    diffId?: string;
    showContent?: boolean;
    format?: 'summary' | 'detailed';
  }): Promise<string> {
    const { diffId, showContent = true, format = 'summary' } = args;

    if (diffId) {
      // Review specific diff
      const diff = await this.codeManager.getDiff(diffId);
      if (!diff) {
        return `❌ Diff not found: ${diffId}`;
      }

      const formatted = await this.codeManager.formatDiffForReview(diffId);
      if (!formatted) {
        return `❌ Failed to format diff: ${diffId}`;
      }

      return formatted;
    }

    // Review all pending diffs
    const pendingDiffs = this.codeManager.listPendingDiffs();
    
    if (pendingDiffs.length === 0) {
      return `✅ No pending diffs to review

All changes have been applied or rejected.

**Next steps:**
• task_worker task="next feature" workFolder="/project" - Continue development
• get_next_tasks workFolder="/project" - Find more tasks to work on
• system_status - Check environment health`;
    }

    const parts: string[] = [];
    parts.push(`## 📋 Pending Diffs (${pendingDiffs.length})`);
    parts.push('');

    for (const diff of pendingDiffs) {
      parts.push(`### Diff: ${diff.id}`);
      parts.push(`- **Container**: ${diff.containerId}`);
      parts.push(`- **Created**: ${diff.timestamp.toISOString()}`);
      parts.push(`- **Files Changed**: ${diff.stats.filesChanged}`);
      parts.push(`- **Changes**: +${diff.stats.additions} -${diff.stats.deletions}`);
      
      if (showContent && format === 'detailed') {
        const formatted = await this.codeManager.formatDiffForReview(diff.id);
        if (formatted) {
          parts.push('');
          parts.push(formatted);
        }
      }
      
      parts.push('');
      parts.push('**Next steps:**');
      parts.push(`• review_changes diffId="${diff.id}" format="detailed" - See full changes`);
      parts.push(`• apply_changes diffId="${diff.id}" targetWorkspace="${diff.workspace || '/project'}" - Apply to project`);
      parts.push(`• request_revision diffId="${diff.id}" feedback="..." - Request specific changes`);
      parts.push(`• reject_changes diffId="${diff.id}" reason="..." - Permanently discard`);
      parts.push('');
      parts.push('---');
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Apply a diff to the workspace
   */
  async applyDiff(args: {
    diffId: string;
    targetWorkspace: string;
    confirm?: boolean;
  }): Promise<string> {
    const { diffId, targetWorkspace, confirm = true } = args;

    try {
      await this.codeManager.applyDiff(diffId, targetWorkspace);
      
      return `✅ **Changes Applied Successfully**

**Diff ID**: ${diffId}
**Target**: ${targetWorkspace}
**Status**: All changes merged into your workspace

**Next steps:**
• task_worker task="continue development" workFolder="${targetWorkspace}" - Continue coding
• git commit -m "Applied changes from ${diffId}" - Commit to version control
• system_status - Verify environment health
• get_next_tasks workFolder="${targetWorkspace}" - Find more tasks`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `❌ **Failed to Apply Changes**

**Diff ID**: ${diffId}
**Error**: ${errorMessage}

**Troubleshooting:**
• Ensure the target workspace exists and is writable
• Check if the diff is still valid and hasn't been applied already
• Verify there are no conflicting changes in the workspace

**Next steps:**
• review_changes diffId="${diffId}" format="detailed" - Review diff again
• system_status - Check environment state
• reject_changes diffId="${diffId}" reason="${errorMessage}" - Discard if needed`;
    }
  }

  /**
   * Reject a diff
   */
  async rejectDiff(args: {
    diffId: string;
    reason?: string;
  }): Promise<string> {
    const { diffId, reason } = args;

    try {
      await this.codeManager.rejectDiff(diffId);
      
      return `✅ **Changes Rejected**

**Diff ID**: ${diffId}
${reason ? `**Reason**: ${reason}` : ''}
**Status**: Changes discarded and cleaned up

**Next steps:**
• task_worker task="alternative approach" workFolder="/project" - Start fresh with new approach
• request_revision diffId="${diffId}" feedback="..." - Request specific changes
• system_status - Verify clean environment

💡 Note: Consider using request_revision instead to preserve working code`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `❌ **Failed to Reject Changes**

**Diff ID**: ${diffId}
**Error**: ${errorMessage}

The diff may have already been applied or rejected.`;
    }
  }

  /**
   * Request a revision to existing changes
   */
  async requestRevision(args: RevisionRequest): Promise<string> {
    const { diffId, feedback, preserveCorrectParts = true, additionalContext } = args;
    
    try {
      const result = await this.codeManager.requestRevision(args);
      
      if (!result.success) {
        return `❌ **Failed to Request Revision**

**Diff ID**: ${diffId}
**Error**: ${result.error || 'Unknown error'}

**Troubleshooting:**
• Ensure the diff exists and hasn't been applied yet
• Check if the container session is still available
• Maximum 3 revisions allowed per diff

**Next steps:**
• review_changes diffId="${diffId}" - Review current state
• reject_changes diffId="${diffId}" - Start over with new approach
• task_worker task="${feedback}" workFolder="/project" - Try manually`;
      }
      
      return `✅ **Revision Started Successfully**

**Original Diff**: ${diffId}
**Revision Number**: ${result.revisionCount || 1}
**Task ID**: ${result.taskId}
**New Diff ID**: ${result.newDiffId || 'Pending...'}

**Feedback Applied**:
${feedback}

${additionalContext ? `**Additional Context**:\n${additionalContext}\n` : ''}
**Next steps:**
• work_status taskId="${result.taskId}" - Monitor revision progress
• view_container_logs identifier="${result.taskId}" - View detailed logs
• review_changes diffId="${result.newDiffId || 'pending'}" - Review revised changes once complete

💡 Pro tip: Claude will preserve working code while addressing your feedback`;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `❌ **Failed to Request Revision**

**Diff ID**: ${diffId}
**Error**: ${errorMessage}

**Next steps:**
• review_changes diffId="${diffId}" - Check current state
• reject_changes diffId="${diffId}" - Discard and start over
• system_status - Check environment health`;
    }
  }

  /**
   * Get security and system status
   */
  async getSecurityStatus(): Promise<string> {
    const status = await this.codeManager.getStatus();
    
    const parts: string[] = [];
    parts.push('## 🖥️ System Status');
    parts.push('');
    
    // Container Pool Status
    parts.push('### Container Pool');
    parts.push(`- **Total Containers**: ${status.containerPool.totalContainers}`);
    parts.push(`- **Active**: ${status.containerPool.activeContainers}`);
    parts.push(`- **Available**: ${status.containerPool.availableContainers}`);
    parts.push(`- **Creating**: ${status.containerPool.containersCreating}`);
    parts.push('');
    
    // Pending Diffs
    parts.push('### Diff Management');
    parts.push(`- **Pending Diffs**: ${status.pendingDiffs}`);
    parts.push('');
    
    // Background Tasks
    parts.push('### Background Tasks');
    parts.push(`- **Total**: ${status.backgroundTasks.total}`);
    parts.push(`- **Running**: ${status.backgroundTasks.running}`);
    parts.push(`- **Completed**: ${status.backgroundTasks.completed}`);
    parts.push(`- **Failed**: ${status.backgroundTasks.failed}`);
    
    if (status.backgroundTasks.tasks.length > 0) {
      parts.push('');
      parts.push('**Active Tasks:**');
      for (const task of status.backgroundTasks.tasks) {
        if (task.status === 'running' || task.status === 'started') {
          parts.push(`- ${task.id}: ${task.status} (${task.progress || 'In progress...'})`);
        }
      }
    }
    
    parts.push('');
    
    // Auth Status
    parts.push('### Authentication');
    parts.push(`- **Claude CLI**: ${status.authStatus.authenticated ? '✅ Authenticated' : '❌ Not authenticated'}`);
    if (status.authStatus.username) {
      parts.push(`- **User**: ${status.authStatus.username}`);
    }
    
    parts.push('');
    parts.push('---');
    parts.push(`*System status as of ${new Date().toISOString()}*`);
    
    // Add next steps based on status
    parts.push('');
    parts.push('**Next steps:**');
    
    if (status.pendingDiffs > 0) {
      parts.push(`• review_changes - Review ${status.pendingDiffs} pending diff(s)`);
    }
    
    if (status.backgroundTasks.running > 0) {
      parts.push(`• work_status - Monitor ${status.backgroundTasks.running} running task(s)`);
    }
    
    if (status.containerPool.availableContainers < 2) {
      parts.push(`• Wait for containers to become available (${status.containerPool.availableContainers} available)`);
    } else {
      parts.push(`• task_worker - Continue development (${status.containerPool.availableContainers} containers available)`);
    }
    
    parts.push(`• dashboard_status - Check visual monitoring availability`);
    
    return parts.join('\n');
  }
}