<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { containersForSelectedRepo, selectedContainer, dashboardActions } from '../stores/dashboard';
  import { Terminal, X, Monitor, Play, Square } from 'lucide-svelte';
  import type { Container } from '../stores/dashboard';

  let terminalContainer: HTMLDivElement;
  let terminals: Map<string, any> = new Map();
  let currentTerminal: any = null;

  // Dynamic imports for xterm
  let Terminal_: any = null;
  let FitAddon_: any = null;
  let WebLinksAddon_: any = null;

  onMount(async () => {
    try {
      // Dynamic import of xterm modules
      const { Terminal: TerminalClass } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');
      
      Terminal_ = TerminalClass;
      FitAddon_ = FitAddon;
      WebLinksAddon_ = WebLinksAddon;

      // Load CSS dynamically
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
      document.head.appendChild(link);

    } catch (error) {
      console.error('Failed to load xterm:', error);
    }
  });

  onDestroy(() => {
    // Clean up all terminals
    terminals.forEach(terminal => {
      terminal.dispose();
    });
    terminals.clear();
  });

  function selectContainer(container: Container | null) {
    const containerId = container?.id || null;
    dashboardActions.selectContainer(containerId);
    
    if (container && Terminal_) {
      createOrSelectTerminal(container);
    }
  }

  function createOrSelectTerminal(container: Container) {
    if (!Terminal_ || !terminalContainer) return;

    // Check if terminal already exists
    if (terminals.has(container.id)) {
      currentTerminal = terminals.get(container.id);
      currentTerminal.terminal.open(terminalContainer);
      currentTerminal.fitAddon.fit();
      return;
    }

    // Clear container
    terminalContainer.innerHTML = '';

    // Create new terminal
    const terminal = new Terminal_({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selection: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#e3b341',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#56d4dd',
        white: '#e6edf3',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#f2cc60',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Monaco", "Menlo", "Ubuntu Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      rows: 30,
      cols: 120,
      scrollback: 1000,
      bellStyle: 'none',
      cursorBlink: false,
      convertEol: true
    });

    const fitAddon = new FitAddon_();
    const webLinksAddon = new WebLinksAddon_();
    
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalContainer);
    fitAddon.fit();

    // Display container info
    terminal.writeln(`\x1b[36m╭─ Container: ${container.name}\x1b[0m`);
    terminal.writeln(`\x1b[36m├─ Status: ${container.status}\x1b[0m`);
    terminal.writeln(`\x1b[36m├─ Started: ${container.startTime.toLocaleString()}\x1b[0m`);
    terminal.writeln(`\x1b[36m╰─ Logs:\x1b[0m`);
    terminal.writeln('');

    // Load existing logs
    if (container.logs && container.logs.length > 0) {
      container.logs.forEach(log => {
        terminal.writeln(log);
      });
    } else {
      terminal.writeln('\x1b[90m[Waiting for logs...]\x1b[0m');
    }

    const terminalData = {
      terminal,
      fitAddon,
      container: container.id
    };

    terminals.set(container.id, terminalData);
    currentTerminal = terminalData;

    // Handle resize
    const resizeHandler = () => {
      if (currentTerminal?.container === container.id) {
        fitAddon.fit();
      }
    };
    window.addEventListener('resize', resizeHandler);

    // Clean up on terminal disposal
    terminal.onDispose(() => {
      window.removeEventListener('resize', resizeHandler);
      terminals.delete(container.id);
      if (currentTerminal?.container === container.id) {
        currentTerminal = null;
      }
    });
  }

  function closeContainer(containerId: string, event: Event) {
    event.stopPropagation();
    
    // Close terminal
    const terminal = terminals.get(containerId);
    if (terminal) {
      terminal.terminal.dispose();
      terminals.delete(containerId);
      if (currentTerminal?.container === containerId) {
        currentTerminal = null;
        if (terminalContainer) {
          terminalContainer.innerHTML = '';
        }
      }
    }

    // Remove from store (this would typically send a stop command to the container)
    dashboardActions.removeContainer(containerId);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return '#10b981';
      case 'stopped': return '#6b7280';
      case 'exited': return '#ef4444';
      default: return '#9ca3af';
    }
  }

  // Reactive updates for container logs
  $: if ($selectedContainer && currentTerminal && Terminal_) {
    const container = $selectedContainer;
    if (container.logs && currentTerminal.container === container.id) {
      // This would ideally append only new logs, but for simplicity we're not tracking the last position
      // In a real implementation, you'd track log positions to avoid duplicates
    }
  }

  // Auto-select first container when containers change
  $: if ($containersForSelectedRepo.length > 0 && !$selectedContainer) {
    const runningContainer = $containersForSelectedRepo.find(c => c.status === 'running');
    if (runningContainer) {
      selectContainer(runningContainer);
    }
  }
</script>

<div class="logs-panel">
  <div class="panel-header">
    <div class="header-left">
      <Monitor size={16} />
      <h3>Container Logs</h3>
    </div>
    <div class="header-right">
      {#if $containersForSelectedRepo.length > 0}
        <span class="container-count">{$containersForSelectedRepo.length} active</span>
      {/if}
    </div>
  </div>

  {#if $containersForSelectedRepo.length > 0}
    <!-- Container Tabs -->
    <div class="container-tabs">
      {#each $containersForSelectedRepo as container (container.id)}
        <div 
          class="container-tab" 
          class:active={$selectedContainer?.id === container.id}
          on:click={() => selectContainer(container)}
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && selectContainer(container)}
        >
          <div class="tab-status" style="background-color: {getStatusColor(container.status)}"></div>
          <span class="tab-name">{container.name}</span>
          <span class="tab-id">({container.id.substring(0, 8)})</span>
          <button 
            class="close-btn"
            on:click={(e) => closeContainer(container.id, e)}
            title="Stop Container"
          >
            <X size={12} />
          </button>
        </div>
      {/each}
    </div>

    <!-- Terminal Display -->
    <div class="terminal-wrapper">
      <div bind:this={terminalContainer} class="terminal-container"></div>
    </div>
  {:else}
    <!-- Empty State -->
    <div class="empty-state">
      <Terminal class="empty-state-icon" size={64} />
      <h3 class="empty-title">No Active Containers</h3>
      <p class="empty-description">
        {#if !$selectedContainer}
          Select a repository with active containers to view logs.
        {:else}
          Start a task or run code to see container logs here.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .logs-panel {
    flex: 1;
    background: #0f1419;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    height: 50px;
    background: #1a1f2e;
    border-bottom: 1px solid #2d3748;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e5e7eb;
  }

  .header-left h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .container-count {
    font-size: 12px;
    color: #64d9f3;
    background: rgba(100, 217, 243, 0.1);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .container-tabs {
    display: flex;
    background: #1a1f2e;
    border-bottom: 1px solid #2d3748;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .container-tabs::-webkit-scrollbar {
    display: none;
  }

  .container-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    border-right: 1px solid #2d3748;
    font-size: 12px;
    white-space: nowrap;
    transition: all 0.2s ease;
    background: #1a1f2e;
    color: #9ca3af;
    min-width: 0;
  }

  .container-tab:hover {
    background: #2d3748;
    color: #e5e7eb;
  }

  .container-tab.active {
    background: #1e3a8a;
    color: #64d9f3;
    border-bottom: 2px solid #64d9f3;
  }

  .tab-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tab-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-id {
    opacity: 0.7;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 10px;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.2s ease;
    padding: 0;
    margin-left: 4px;
    flex-shrink: 0;
  }

  .close-btn:hover {
    opacity: 1;
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .terminal-wrapper {
    flex: 1;
    background: #0d1117;
    overflow: hidden;
    position: relative;
  }

  :global(.terminal-container) {
    width: 100%;
    height: 100%;
    padding: 16px;
  }

  :global(.terminal-container .xterm) {
    height: 100% !important;
  }

  :global(.terminal-container .xterm-viewport) {
    background-color: transparent !important;
  }

  :global(.terminal-container .xterm-screen) {
    background-color: transparent !important;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40px;
    text-align: center;
    background: #0d1117;
  }

  :global(.empty-state-icon) {
    color: #4b5563;
    margin-bottom: 24px;
    opacity: 0.4;
  }

  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: #9ca3af;
    margin: 0 0 12px 0;
  }

  .empty-description {
    font-size: 14px;
    color: #6b7280;
    margin: 0;
    line-height: 1.5;
    max-width: 300px;
  }

  /* Responsive design */
  @media (max-width: 1024px) {
    .container-tab {
      padding: 6px 12px;
      font-size: 11px;
    }
    
    .tab-name {
      max-width: 80px;
    }
  }

  @media (max-width: 768px) {
    .panel-header {
      padding: 0 16px;
    }
    
    .container-tabs {
      overflow-x: scroll;
    }
    
    .container-tab {
      padding: 8px 12px;
      min-width: 120px;
    }
    
    :global(.terminal-container) {
      padding: 12px;
    }
  }
</style>
