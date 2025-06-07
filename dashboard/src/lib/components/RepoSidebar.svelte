<script lang="ts">
  import { repositories, dashboardActions, dashboardStore } from '../stores/dashboard';
  import { FolderOpen, Folder, Activity, GitBranch, FileText, Container } from 'lucide-svelte';

  function selectRepo(repoId: string) {
    dashboardActions.selectRepo(repoId);
  }

  function getRepoDisplayName(repoPath: string): string {
    return repoPath.split('/').pop() || repoPath;
  }

  function formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <h2>Active Repositories</h2>
    <div class="repo-count">{$repositories.length}</div>
  </div>
  
  <div class="repo-list">
    {#each $repositories as repo (repo.id)}
      <div 
        class="repo-item" 
        class:selected={$dashboardStore.selectedRepoId === repo.id}
        class:active={repo.isActive}
        on:click={() => selectRepo(repo.id)}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && selectRepo(repo.id)}
      >
        <div class="repo-icon">
          {#if repo.isActive}
            <FolderOpen size={16} class="folder-icon active" />
          {:else}
            <Folder size={16} class="folder-icon" />
          {/if}
        </div>
        
        <div class="repo-info">
          <div class="repo-name">{getRepoDisplayName(repo.path)}</div>
          <div class="repo-path">{repo.path}</div>
          <div class="repo-stats">
            {#if repo.taskCount > 0}
              <div class="stat">
                <Activity size={10} />
                <span>{repo.taskCount}</span>
              </div>
            {/if}
            {#if repo.containerCount > 0}
              <div class="stat">
                <Container size={10} />
                <span>{repo.containerCount}</span>
              </div>
            {/if}
            {#if repo.diffCount > 0}
              <div class="stat">
                <FileText size={10} />
                <span>{repo.diffCount}</span>
              </div>
            {/if}
          </div>
          {#if repo.lastActivity}
            <div class="last-activity">
              {formatTime(repo.lastActivity)}
            </div>
          {/if}
        </div>
        
        {#if repo.isActive}
          <div class="activity-indicator">
            <div class="pulse-dot"></div>
          </div>
        {/if}
      </div>
    {/each}
    
    {#if $repositories.length === 0}
      <div class="empty-state">
        <GitBranch class="empty-state-icon" size={48} />
        <p class="empty-title">No Active Repositories</p>
        <p class="empty-description">
          Start a task or run a container to see repositories here.
        </p>
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 280px;
    background: #1a1f2e;
    border-right: 1px solid #2d3748;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 16px 20px;
    border-bottom: 1px solid #2d3748;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #e5e7eb;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .repo-count {
    background: #374151;
    color: #d1d5db;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
  }

  .repo-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .repo-item {
    display: flex;
    align-items: flex-start;
    padding: 12px 16px;
    margin: 2px 0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;
    position: relative;
  }

  .repo-item:hover {
    background: #2d3748;
    border-color: #4a5568;
  }

  .repo-item.selected {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .repo-item.active {
    border-left: 3px solid #10b981;
  }

  .repo-icon {
    margin-right: 12px;
    margin-top: 2px;
    flex-shrink: 0;
  }

  :global(.folder-icon) {
    color: #9ca3af;
  }

  :global(.folder-icon.active) {
    color: #10b981;
  }

  .repo-info {
    flex: 1;
    min-width: 0;
  }

  .repo-name {
    font-weight: 500;
    font-size: 14px;
    color: #e5e7eb;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-path {
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-stats {
    display: flex;
    gap: 12px;
    margin-bottom: 4px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #6b7280;
  }

  .last-activity {
    font-size: 10px;
    color: #6b7280;
  }

  .activity-indicator {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
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
