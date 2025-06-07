import { browser } from '$app/environment';
import { dashboardActions } from '../stores/dashboard';

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectInterval: number = 5000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private reconnectTimer: number | null = null;
  private url: string;

  constructor() {
    // Only initialize in browser environment
    if (!browser) {
      this.url = '';
      return;
    }
    
    // Use the same port as the streaming server from the enhanced server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = import.meta.env.DEV ? '47821' : window.location.port;
    this.url = `${protocol}//${host}:${port}/stream`;
  }

  async connect(): Promise<void> {
    try {
      console.log('Connecting to WebSocket at:', this.url);
      
      // For development, try HTTP-based EventSource first
      if (import.meta.env.DEV) {
        try {
          await this.connectEventSource();
          return;
        } catch (error) {
          console.warn('EventSource failed, falling back to WebSocket:', error);
        }
      }

      this.ws = new WebSocket(this.url);
      this.setupWebSocketHandlers();
      
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private async connectEventSource(): Promise<void> {
    const eventSourceUrl = `http://localhost:47821/stream`;
    console.log('Connecting to EventSource at:', eventSourceUrl);
    
    const eventSource = new EventSource(eventSourceUrl);
    
    eventSource.onopen = () => {
      console.log('EventSource connected');
      dashboardActions.setConnectionStatus(true);
      this.reconnectAttempts = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse EventSource message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      dashboardActions.setConnectionStatus(false);
      eventSource.close();
      this.scheduleReconnect();
    };

    // Keep reference for cleanup
    this.ws = eventSource as any;
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      dashboardActions.setConnectionStatus(true);
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      dashboardActions.setConnectionStatus(false);
      
      if (event.code !== 1000) { // Not a normal closure
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      dashboardActions.setConnectionStatus(false);
    };
  }

  private handleMessage(message: WebSocketMessage): void {
    console.log('Received message:', message.type, message.data);

    switch (message.type) {
      case 'task_progress':
        this.handleTaskProgress(message.data);
        break;
      
      case 'container_started':
        this.handleContainerStarted(message.data);
        break;
      
      case 'container_stopped':
        this.handleContainerStopped(message.data);
        break;
      
      case 'container_logs':
        this.handleContainerLogs(message.data);
        break;
      
      case 'diff_created':
        this.handleDiffCreated(message.data);
        break;
      
      case 'repo_activity':
        this.handleRepoActivity(message.data);
        break;
      
      case 'task_created':
        this.handleTaskCreated(message.data);
        break;
      
      case 'task_completed':
        this.handleTaskCompleted(message.data);
        break;
      
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private handleTaskProgress(data: any): void {
    dashboardActions.updateTask(data.taskId, {
      status: data.status,
      progress: data.progress,
      ...(data.error && { metadata: { error: data.error } })
    });
  }

  private handleContainerStarted(data: any): void {
    const container = {
      id: data.containerId,
      name: data.containerName || data.containerId.substring(0, 12),
      status: 'running' as const,
      repoId: data.repoId || 'unknown',
      taskId: data.taskId,
      image: data.image || 'claude-parallel-work',
      startTime: new Date(data.startTime || Date.now()),
      logs: []
    };

    dashboardActions.addContainer(container);
    
    // Update repository activity
    this.updateRepoActivity(data.repoId);
  }

  private handleContainerStopped(data: any): void {
    dashboardActions.updateContainer(data.containerId, {
      status: 'stopped'
    });
  }

  private handleContainerLogs(data: any): void {
    if (data.containerId && data.logLine) {
      dashboardActions.appendContainerLog(data.containerId, data.logLine);
    }
  }

  private handleDiffCreated(data: any): void {
    const diff = {
      id: data.diffId,
      repoId: data.repoId,
      taskId: data.taskId,
      status: 'pending' as const,
      filesChanged: data.filesChanged || 0,
      additions: data.additions || 0,
      deletions: data.deletions || 0,
      createdAt: new Date(data.createdAt || Date.now()),
      summary: data.summary
    };

    dashboardActions.updateDiffs([diff]); // This should be addDiff but we'll use what we have
    this.updateRepoActivity(data.repoId);
  }

  private handleRepoActivity(data: any): void {
    this.updateRepoActivity(data.repoId, data.activity);
  }

  private handleTaskCreated(data: any): void {
    const task = {
      id: data.taskId,
      title: data.title || data.description?.substring(0, 50) + '...' || 'Untitled Task',
      description: data.description || '',
      status: data.status || 'pending' as const,
      repoId: data.repoId,
      startTime: new Date(data.startTime || Date.now()),
      parentTaskId: data.parentTaskId,
      metadata: data.metadata
    };

    dashboardActions.addTask(task);
    this.updateRepoActivity(data.repoId);
  }

  private handleTaskCompleted(data: any): void {
    dashboardActions.updateTask(data.taskId, {
      status: 'completed',
      endTime: new Date(data.endTime || Date.now()),
      ...(data.diffId && { diffId: data.diffId })
    });
  }

  private updateRepoActivity(repoId: string, activity?: any): void {
    // This would need to be implemented in the store
    // For now, we'll trigger a data refresh
    if (repoId) {
      console.log('Repository activity updated:', repoId, activity);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * this.reconnectAttempts, 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      if (this.ws instanceof WebSocket) {
        this.ws.close(1000, 'Manual disconnect');
      } else {
        // EventSource
        (this.ws as any).close();
      }
      this.ws = null;
    }

    dashboardActions.setConnectionStatus(false);
  }

  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message:', message);
    }
  }
}

export const websocketService = new WebSocketService();
