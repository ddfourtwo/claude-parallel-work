import { writable, derived } from 'svelte/store';

export interface Repository {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  taskCount: number;
  containerCount: number;
  diffCount: number;
  lastActivity: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  repoId: string;
  startTime?: Date;
  endTime?: Date;
  progress?: number;
  containerId?: string;
  diffId?: string;
  parentTaskId?: string;
  metadata?: Record<string, any>;
}

export interface Container {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'created' | 'exited';
  repoId: string;
  taskId?: string;
  image: string;
  startTime: Date;
  ports?: string[];
  logs?: string[];
}

export interface Diff {
  id: string;
  repoId: string;
  taskId?: string;
  status: 'pending' | 'approved' | 'rejected';
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: Date;
  summary?: string;
}

export interface DashboardState {
  repositories: Repository[];
  tasks: Task[];
  containers: Container[];
  diffs: Diff[];
  selectedRepoId: string | null;
  selectedContainerId: string | null;
  isConnected: boolean;
  lastUpdate: Date | null;
}

const initialState: DashboardState = {
  repositories: [],
  tasks: [],
  containers: [],
  diffs: [],
  selectedRepoId: null,
  selectedContainerId: null,
  isConnected: false,
  lastUpdate: null
};

// Main dashboard store
export const dashboardStore = writable<DashboardState>(initialState);

// Derived stores for easier access
export const repositories = derived(dashboardStore, $store => $store.repositories);
export const selectedRepo = derived(dashboardStore, $store => 
  $store.repositories.find(repo => repo.id === $store.selectedRepoId) || null
);

export const tasksForSelectedRepo = derived(dashboardStore, $store => 
  $store.selectedRepoId 
    ? $store.tasks.filter(task => task.repoId === $store.selectedRepoId)
    : []
);

export const containersForSelectedRepo = derived(dashboardStore, $store => 
  $store.selectedRepoId 
    ? $store.containers.filter(container => container.repoId === $store.selectedRepoId)
    : []
);

export const diffsForSelectedRepo = derived(dashboardStore, $store => 
  $store.selectedRepoId 
    ? $store.diffs.filter(diff => diff.repoId === $store.selectedRepoId)
    : []
);

export const selectedContainer = derived(dashboardStore, $store => 
  $store.containers.find(container => container.id === $store.selectedContainerId) || null
);

export const connectionStatus = derived(dashboardStore, $store => $store.isConnected);

// Actions
export const dashboardActions = {
  selectRepo: (repoId: string | null) => {
    dashboardStore.update(state => ({
      ...state,
      selectedRepoId: repoId,
      selectedContainerId: null // Reset container selection when repo changes
    }));
  },

  selectContainer: (containerId: string | null) => {
    dashboardStore.update(state => ({
      ...state,
      selectedContainerId: containerId
    }));
  },

  setConnectionStatus: (isConnected: boolean) => {
    dashboardStore.update(state => ({
      ...state,
      isConnected,
      lastUpdate: new Date()
    }));
  },

  updateRepositories: (repositories: Repository[]) => {
    dashboardStore.update(state => ({
      ...state,
      repositories,
      lastUpdate: new Date()
    }));
  },

  updateTasks: (tasks: Task[]) => {
    dashboardStore.update(state => ({
      ...state,
      tasks,
      lastUpdate: new Date()
    }));
  },

  updateContainers: (containers: Container[]) => {
    dashboardStore.update(state => ({
      ...state,
      containers,
      lastUpdate: new Date()
    }));
  },

  updateDiffs: (diffs: Diff[]) => {
    dashboardStore.update(state => ({
      ...state,
      diffs,
      lastUpdate: new Date()
    }));
  },

  addTask: (task: Task) => {
    dashboardStore.update(state => ({
      ...state,
      tasks: [...state.tasks, task],
      lastUpdate: new Date()
    }));
  },

  updateTask: (taskId: string, updates: Partial<Task>) => {
    dashboardStore.update(state => ({
      ...state,
      tasks: state.tasks.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      ),
      lastUpdate: new Date()
    }));
  },

  addContainer: (container: Container) => {
    dashboardStore.update(state => ({
      ...state,
      containers: [...state.containers, container],
      lastUpdate: new Date()
    }));
  },

  updateContainer: (containerId: string, updates: Partial<Container>) => {
    dashboardStore.update(state => ({
      ...state,
      containers: state.containers.map(container => 
        container.id === containerId ? { ...container, ...updates } : container
      ),
      lastUpdate: new Date()
    }));
  },

  removeContainer: (containerId: string) => {
    dashboardStore.update(state => ({
      ...state,
      containers: state.containers.filter(container => container.id !== containerId),
      selectedContainerId: state.selectedContainerId === containerId ? null : state.selectedContainerId,
      lastUpdate: new Date()
    }));
  },

  appendContainerLog: (containerId: string, logLine: string) => {
    dashboardStore.update(state => ({
      ...state,
      containers: state.containers.map(container => 
        container.id === containerId 
          ? { 
              ...container, 
              logs: [...(container.logs || []), logLine].slice(-1000) // Keep last 1000 lines
            } 
          : container
      ),
      lastUpdate: new Date()
    }));
  },

  loadInitialData: async () => {
    try {
      // Load initial data from the API
      const [reposResponse, tasksResponse, containersResponse, diffsResponse] = await Promise.all([
        fetch('/api/repositories'),
        fetch('/api/tasks'),
        fetch('/api/containers'),
        fetch('/api/diffs')
      ]);

      if (reposResponse.ok) {
        const repositories = await reposResponse.json();
        dashboardActions.updateRepositories(repositories);
      }

      if (tasksResponse.ok) {
        const tasks = await tasksResponse.json();
        dashboardActions.updateTasks(tasks);
      }

      if (containersResponse.ok) {
        const containers = await containersResponse.json();
        dashboardActions.updateContainers(containers);
      }

      if (diffsResponse.ok) {
        const diffs = await diffsResponse.json();
        dashboardActions.updateDiffs(diffs);
      }

      // Auto-select first active repository
      dashboardStore.update(state => {
        const activeRepo = state.repositories.find(repo => repo.isActive);
        if (activeRepo && !state.selectedRepoId) {
          return {
            ...state,
            selectedRepoId: activeRepo.id
          };
        }
        return state;
      });

    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }
};
