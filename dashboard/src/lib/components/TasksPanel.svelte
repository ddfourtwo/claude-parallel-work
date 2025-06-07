<script lang="ts">
  import { tasksForSelectedRepo, diffsForSelectedRepo, selectedRepo } from '../stores/dashboard';
  import { Activity, Clock, CheckCircle, XCircle, AlertCircle, FileText, GitMerge } from 'lucide-svelte';
  import type { Task, Diff } from '../stores/dashboard';

  function getStatusIcon(status: string) {
    switch (status) {
      case 'running': return Activity;
      case 'completed': return CheckCircle;
      case 'failed': return XCircle;
      case 'pending': return Clock;
      default: return AlertCircle;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return 'status-running';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'pending': return 'status-pending';
      default: return 'status-pending';
    }
  }

  function formatDuration(task: Task): string {
    if (!task.startTime) return '';
    
    const endTime = task.endTime || new Date();
    const duration = endTime.getTime() - task.startTime.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getDiffStatusColor(status: string): string {
    switch (status) {
      case 'approved': return 'diff-approved';
      case 'rejected': return 'diff-rejected';
      case 'pending': return 'diff-pending';
      default: return 'diff-pending';
    }
  }
</script>

<div class="tasks-panel">
  <div class="panel-header">
    <h2>
      {#if $selectedRepo}
        {$selectedRepo.name}
      {:else}
        Tasks & Status
      {/if}
    </h2>
    {#if $selectedRepo}
      <div class="panel-stats">
        <span class="stat tasks">{$tasksForSelectedRepo.length} tasks</span>
        <span class="stat diffs">{$diffsForSelectedRepo.length} diffs</span>
      </div>
    {/if}
  </div>
  
  <div class="panel-content">
    {#if !$selectedRepo}
      <div class="empty-state">
        <Activity class="empty-state-icon" size={48} />
        <p class="empty-title">Select a Repository</p>
        <p class="empty-description">
          Choose a repository from the sidebar to view its tasks and status.
        </p>
      </div>
    {:else}
      <!-- Tasks Section -->
      <div class="section">
        <div class="section-header">
          <Activity size={16} />
          <h3>Tasks</h3>
          <span class="count">{$tasksForSelectedRepo.length}</span>
        </div>
        
        <div class="section-content">
          {#each $tasksForSelectedRepo as task (task.id)}
            <div class="task-item">
              <div class="task-header">
                <div class="task-status-icon">
                  <svelte:component this={getStatusIcon(task.status)} size={14} />
                </div>
                <div class="task-title">{task.title}</div>
                <div class="task-status {getStatusColor(task.status)}">
                  {task.status}
                </div>
              </div>
              
              {#if task.description}
                <div class="task-description">
                  {task.description.length > 100 
                    ? task.description.substring(0, 100) + '...'
                    : task.description
                  }
                </div>
              {/if}
              
              <div class="task-meta">
                <div class="task-timing">
                  {#if task.startTime}
                    <span class="time-label">Started:</span>
                    <span class="time-value">{formatTime(task.startTime)}</span>
                  {/if}
                  {#if task.status === 'running' || task.endTime}
                    <span class="duration">{formatDuration(task)}</span>
                  {/if}
                </div>
                
                {#if task.progress !== undefined}
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: {task.progress}%"></div>
                  </div>
                {/if}
              </div>
              
              {#if task.containerId}
                <div class="task-container">
                  <span class="container-label">Container:</span>
                  <span class="container-id">{task.containerId.substring(0, 12)}</span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="section-empty">
              <Clock size={24} />
              <p>No tasks for this repository</p>
            </div>
          {/each}
        </div>
      </div>
      
      <!-- Diffs Section -->
      <div class="section">
        <div class="section-header">
          <FileText size={16} />
          <h3>Pending Changes</h3>
          <span class="count">{$diffsForSelectedRepo.length}</span>
        </div>
        
        <div class="section-content">
          {#each $diffsForSelectedRepo as diff (diff.id)}
            <div class="diff-item">
              <div class="diff-header">
                <GitMerge size={14} class="diff-icon" />
                <div class="diff-title">
                  {diff.summary || `${diff.filesChanged} files changed`}
                </div>
                <div class="diff-status {getDiffStatusColor(diff.status)}">
                  {diff.status}
                </div>
              </div>
              
              <div class="diff-stats">
                <span class="stat files">
                  {diff.filesChanged} files
                </span>
                <span class="stat additions">
                  +{diff.additions}
                </span>
                <span class="stat deletions">
                  -{diff.deletions}
                </span>
              </div>
              
              <div class="diff-meta">
                <span class="diff-time">
                  {formatTime(diff.createdAt)}
                </span>
                {#if diff.taskId}
                  <span class="diff-task">
                    Task: {diff.taskId.substring(0, 8)}
                  </span>
                {/if}
              </div>
            </div>
          {:else}
            <div class="section-empty">
              <FileText size={24} />
              <p>No pending changes</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .tasks-panel {
    width: 350px;
    background: #1e2330;
    border-right: 1px solid #2d3748;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid #2d3748;
    background: #1a1f2e;
  }

  .panel-header h2 {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 600;
    color: #e5e7eb;
  }

  .panel-stats {
    display: flex;
    gap: 16px;
  }

  .stat {
    font-size: 12px;
    color: #9ca3af;
  }

  .stat.tasks {
    color: #64d9f3;
  }

  .stat.diffs {
    color: #f59e0b;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .section {
    border-bottom: 1px solid #2d3748;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: #1a1f2e;
    border-bottom: 1px solid #2d3748;
    font-size: 13px;
    font-weight: 600;
    color: #d1d5db;
  }

  .section-header h3 {
    margin: 0;
    flex: 1;
  }

  .count {
    background: #374151;
    color: #d1d5db;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    min-width: 16px;
    text-align: center;
  }

  .section-content {
    padding: 0;
  }

  .task-item {
    padding: 16px 20px;
    border-bottom: 1px solid #2d3748;
    transition: background 0.2s ease;
  }

  .task-item:hover {
    background: #2d3748;
  }

  .task-item:last-child {
    border-bottom: none;
  }

  .task-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .task-status-icon {
    color: #9ca3af;
  }

  .task-title {
    font-weight: 500;
    font-size: 14px;
    color: #e5e7eb;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-status {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-running {
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
  }

  .status-completed {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .status-failed {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .status-pending {
    background: rgba(107, 114, 128, 0.2);
    color: #9ca3af;
  }

  .task-description {
    font-size: 12px;
    color: #9ca3af;
    margin-bottom: 8px;
    line-height: 1.4;
  }

  .task-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #6b7280;
  }

  .task-timing {
    display: flex;
    gap: 8px;
  }

  .time-label {
    opacity: 0.7;
  }

  .time-value {
    color: #9ca3af;
  }

  .duration {
    color: #64d9f3;
    font-weight: 500;
  }

  .progress-bar {
    width: 60px;
    height: 4px;
    background: #374151;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #64d9f3;
    transition: width 0.3s ease;
  }

  .task-container {
    margin-top: 8px;
    font-size: 11px;
    color: #6b7280;
  }

  .container-label {
    opacity: 0.7;
  }

  .container-id {
    color: #9ca3af;
    font-family: 'Monaco', 'Menlo', monospace;
  }

  .diff-item {
    padding: 16px 20px;
    border-bottom: 1px solid #2d3748;
    transition: background 0.2s ease;
  }

  .diff-item:hover {
    background: #2d3748;
  }

  .diff-item:last-child {
    border-bottom: none;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .diff-icon {
    color: #9ca3af;
  }

  .diff-title {
    font-weight: 500;
    font-size: 14px;
    color: #e5e7eb;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-status {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .diff-pending {
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
  }

  .diff-approved {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .diff-rejected {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .diff-stats {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 11px;
  }

  .diff-stats .stat.files {
    color: #9ca3af;
  }

  .diff-stats .stat.additions {
    color: #10b981;
  }

  .diff-stats .stat.deletions {
    color: #ef4444;
  }

  .diff-meta {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #6b7280;
  }

  .diff-task {
    font-family: 'Monaco', 'Menlo', monospace;
  }

  .section-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    color: #6b7280;
    text-align: center;
  }

  .section-empty p {
    margin: 8px 0 0 0;
    font-size: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40px 20px;
    text-align: center;
    opacity: 0.6;
  }

  :global(.empty-state-icon) {
    color: #4b5563;
    margin-bottom: 16px;
  }

  .empty-title {
    font-size: 14px;
    font-weight: 500;
    color: #9ca3af;
    margin: 0 0 8px 0;
  }

  .empty-description {
    font-size: 12px;
    color: #6b7280;
    margin: 0;
    line-height: 1.4;
  }
</style>
