<script lang="ts">
  import { connectionStatus, dashboardStore } from '../stores/dashboard';
  import { Activity, Wifi, WifiOff } from 'lucide-svelte';

  let lastUpdate = '';
  
  $: {
    if ($dashboardStore.lastUpdate) {
      lastUpdate = $dashboardStore.lastUpdate.toLocaleTimeString();
    }
  }
</script>

<header class="header">
  <div class="header-left">
    <Activity class="logo-icon" size={20} />
    <h1>Claude Parellel Work Dashboard</h1>
  </div>
  
  <div class="header-right">
    <div class="connection-status">
      {#if $connectionStatus}
        <Wifi size={16} class="status-icon connected" />
        <span class="status-text">Connected</span>
      {:else}
        <WifiOff size={16} class="status-icon disconnected" />
        <span class="status-text">Disconnected</span>
      {/if}
    </div>
    
    {#if lastUpdate}
      <div class="last-update">
        <span class="update-label">Last update:</span>
        <span class="update-time">{lastUpdate}</span>
      </div>
    {/if}
  </div>
</header>

<style>
  .header {
    height: 60px;
    background: #1a1f2e;
    border-bottom: 1px solid #2d3748;
    display: flex;
    align-items: center;
    padding: 0 24px;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  :global(.logo-icon) {
    color: #64d9f3;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #64d9f3;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  :global(.status-icon.connected) {
    color: #10b981;
  }

  :global(.status-icon.disconnected) {
    color: #ef4444;
  }

  .status-text {
    color: inherit;
  }

  .last-update {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    opacity: 0.7;
  }

  .update-label {
    color: #9ca3af;
  }

  .update-time {
    color: #e5e7eb;
    font-weight: 500;
  }
</style>
