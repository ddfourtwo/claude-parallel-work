<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import RepoSidebar from '../lib/components/RepoSidebar.svelte';
  import TasksPanel from '../lib/components/TasksPanel.svelte';
  import LogsPanel from '../lib/components/LogsPanel.svelte';
  import Header from '../lib/components/Header.svelte';
  import { dashboardStore } from '../lib/stores/dashboard';
  import { websocketService } from '../lib/services/websocket';

  let mounted = false;

  onMount(async () => {
    mounted = true;
    
    // Initialize WebSocket connection (only in browser)
    if (websocketService) {
      await websocketService.connect();
    }
    
    // Load initial data
    await dashboardStore.loadInitialData();
  });

  onDestroy(() => {
    if (websocketService) {
      websocketService.disconnect();
    }
  });
</script>

<svelte:head>
  <title>Claude Parellel Work Dashboard</title>
</svelte:head>

{#if mounted}
  <div class="dashboard-container">
    <!-- Header -->
    <div class="main-content">
      <Header />
      
      <div class="content-panels">
        <!-- Left Panel: Active Repositories -->
        <RepoSidebar />
        
        <!-- Middle Panel: Tasks & Status -->
        <TasksPanel />
        
        <!-- Right Panel: Container Logs -->
        <LogsPanel />
      </div>
    </div>
  </div>
{:else}
  <!-- Loading state -->
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading Claude Parellel Work Dashboard...</p>
  </div>
{/if}

<style>
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: #0f1419;
    color: #e6e6e6;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #2d3748;
    border-top: 3px solid #64d9f3;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
