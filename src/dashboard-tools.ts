/**
 * Dashboard Management Tools for Claude Parellel Work
 * Provides MCP tools to manage and open the dashboard
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { readFile, access } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

export interface DashboardStatus {
  isRunning: boolean;
  url?: string;
  port?: number;
  serverRunning: boolean;
  dashboardBuilt: boolean;
}

/**
 * Check if the dashboard is currently running
 */
export async function checkDashboardStatus(): Promise<DashboardStatus> {
  const status: DashboardStatus = {
    isRunning: false,
    serverRunning: false,
    dashboardBuilt: false,
  };

  try {
    // Check if dashboard dev server is running (port 5173)
    const { stdout: netstat } = await execAsync('netstat -an 2>/dev/null | grep :5173 || lsof -ti:5173 2>/dev/null || echo ""');
    status.isRunning = netstat.trim().length > 0;
    
    if (status.isRunning) {
      status.url = 'http://localhost:5173';
      status.port = 5173;
    }

    // Check if enhanced server is running (port 47821)
    const { stdout: serverCheck } = await execAsync('netstat -an 2>/dev/null | grep :47821 || lsof -ti:47821 2>/dev/null || echo ""');
    status.serverRunning = serverCheck.trim().length > 0;

    // Check if dashboard is built
    try {
      await access(join(process.cwd(), 'dashboard', 'build'));
      status.dashboardBuilt = true;
    } catch {
      status.dashboardBuilt = false;
    }

  } catch (error) {
    console.warn('Error checking dashboard status:', error);
  }

  return status;
}

/**
 * Open the dashboard in the default browser
 */
export async function openDashboardInBrowser(url: string = 'http://localhost:5173'): Promise<void> {
  const platform = process.platform;
  
  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "${url}"`);
    } else {
      // Linux and others
      await execAsync(`xdg-open "${url}" || firefox "${url}" || chromium "${url}" || google-chrome "${url}"`);
    }
  } catch (error) {
    throw new Error(`Failed to open browser: ${error}`);
  }
}

/**
 * Start the dashboard development server
 */
export async function startDashboard(): Promise<{ pid: number; url: string }> {
  try {
    // Check if already running
    const status = await checkDashboardStatus();
    if (status.isRunning) {
      return { pid: 0, url: status.url! };
    }

    // Start the dashboard in background
    const child = spawn('npm', ['run', 'dashboard'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      shell: true
    });

    // Wait a moment for startup
    await new Promise(resolve => setTimeout(resolve, 3000));

    const url = 'http://localhost:5173';
    
    // Verify it started
    const newStatus = await checkDashboardStatus();
    if (!newStatus.isRunning) {
      throw new Error('Dashboard failed to start');
    }

    return { pid: child.pid || 0, url };
  } catch (error) {
    throw new Error(`Failed to start dashboard: ${error}`);
  }
}

/**
 * Launch the dashboard with auto-browser opening
 */
export async function launchDashboard(): Promise<{ status: string; url: string; serverRunning: boolean }> {
  const status = await checkDashboardStatus();
  
  // Check if enhanced server is running
  if (!status.serverRunning) {
    return {
      status: 'error',
      url: '',
      serverRunning: false
    };
  }

  let url = 'http://localhost:5173';

  // Start dashboard if not running
  if (!status.isRunning) {
    const result = await startDashboard();
    url = result.url;
  }

  // Open in browser
  await openDashboardInBrowser(url);

  return {
    status: 'launched',
    url,
    serverRunning: status.serverRunning
  };
}


/**
 * Get dashboard configuration and setup instructions
 */
export function getDashboardSetupInstructions(): string {
  return `
🎯 **Claude Parellel Work Dashboard Setup**

**Quick Launch:**
1. Start enhanced server: \`npm run start:dashboard\`
2. Open dashboard: Call the \`open_dashboard\` tool
3. Browser opens automatically at: http://localhost:5173

**Manual Setup:**
1. **Terminal 1 - Start Enhanced Server:**
   \`\`\`bash
   npm run start:dashboard
   # Server runs on http://localhost:47821
   \`\`\`

2. **Terminal 2 - Start Dashboard:**
   \`\`\`bash
   npm run dashboard
   # Dashboard runs on http://localhost:5173
   \`\`\`

3. **Open Browser:**
   \`\`\`
   http://localhost:5173
   \`\`\`

**Production Build:**
\`\`\`bash
npm run build:dashboard
\`\`\`

**Features:**
- 🔄 Real-time repository monitoring
- 📊 Live task progress tracking  
- 📱 Container log streaming
- 🔍 Diff management interface
- ⚡ WebSocket live updates

**Troubleshooting:**
- Ensure enhanced server is running first
- Check ports 47821 (server) and 5173 (dashboard) are free
- Use \`dashboard_status\` tool to check configuration
`;
}
