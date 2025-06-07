#!/usr/bin/env node
/**
 * Claude Parallel Work Server Supervisor
 * 
 * Monitors the MCP server and automatically restarts it if it crashes.
 * Provides resilience against server failures and ensures continuous availability.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from './utils/logger.js';
import { loadSupervisorConfig, validateSupervisorConfig, SupervisorConfig } from './supervisor-config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


interface CrashInfo {
  timestamp: Date;
  exitCode: number | null;
  signal: string | null;
  restartCount: number;
}

export class ServerSupervisor {
  private serverProcess: ChildProcess | null = null;
  private isShuttingDown = false;
  private restartCount = 0;
  private lastRestartTime = 0;
  private config: SupervisorConfig;
  private serverPath: string;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private crashHistory: CrashInfo[] = [];

  constructor(config: Partial<SupervisorConfig> = {}) {
    // Load configuration from environment variables, then apply overrides
    const envConfig = loadSupervisorConfig();
    this.config = { ...envConfig, ...config };
    
    // Validate configuration
    validateSupervisorConfig(this.config);

    this.serverPath = path.join(__dirname, 'server.js');
    
    // Ensure server file exists
    if (!fs.existsSync(this.serverPath)) {
      throw new Error(`Server file not found: ${this.serverPath}`);
    }

    this.setupSignalHandlers();
  }

  /**
   * Start the supervisor and server
   */
  async start(): Promise<void> {
    logger.info('Starting Claude Parallel Work Server Supervisor', {
      serverPath: this.serverPath,
      config: this.config
    });

    this.startServer();
    this.startHealthCheck();

    process.stderr.write('[Supervisor] 🛡️ Server supervisor started - automatic restart enabled\n');
  }

  /**
   * Start the MCP server process
   */
  private startServer(): void {
    if (this.isShuttingDown) {
      return;
    }

    logger.info('Starting MCP server process', {
      restartCount: this.restartCount,
      serverPath: this.serverPath
    });

    try {
      this.serverProcess = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SUPERVISOR_MODE: 'true'
        }
      });

      this.setupProcessHandlers();
      
      // Forward stdin to server
      if (process.stdin) {
        process.stdin.pipe(this.serverProcess.stdin!);
      }

      // Forward server stdout to our stdout (for MCP protocol)
      this.serverProcess.stdout?.pipe(process.stdout);

      logger.info('MCP server process started', {
        pid: this.serverProcess.pid,
        restartCount: this.restartCount
      });

    } catch (error) {
      logger.error('Failed to start MCP server process', {
        error: error instanceof Error ? error.message : String(error),
        serverPath: this.serverPath
      });

      this.handleCrash(null, null, 'Failed to start process');
    }
  }

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.serverProcess) return;

    this.serverProcess.on('exit', (code, signal) => {
      this.handleCrash(code, signal);
    });

    this.serverProcess.on('error', (error) => {
      logger.error('Server process error', {
        error: error.message,
        pid: this.serverProcess?.pid
      });
    });

    // Log stderr but don't forward it (to avoid contaminating MCP protocol)
    this.serverProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        logger.debug('Server stderr', { message });
      }
    });
  }

  /**
   * Handle server crash and restart logic
   */
  private handleCrash(exitCode: number | null, signal: string | null, reason?: string): void {
    if (this.isShuttingDown) {
      return;
    }

    const now = Date.now();
    const crashInfo: CrashInfo = {
      timestamp: new Date(),
      exitCode,
      signal,
      restartCount: this.restartCount
    };

    this.crashHistory.push(crashInfo);
    this.serverProcess = null;

    // Clean up old crash history (keep only recent crashes)
    this.crashHistory = this.crashHistory.filter(
      crash => now - crash.timestamp.getTime() < this.config.restartWindow
    );

    logger.error('MCP server process crashed', {
      exitCode,
      signal,
      reason,
      restartCount: this.restartCount,
      recentCrashes: this.crashHistory.length
    });

    // Check if we should restart
    if (this.shouldRestart()) {
      this.scheduleRestart();
    } else {
      logger.error('Max restart attempts exceeded', {
        maxRestarts: this.config.maxRestarts,
        restartWindow: this.config.restartWindow,
        recentCrashes: this.crashHistory.length
      });
      
      process.stderr.write('[Supervisor] ❌ Server has crashed too many times - supervisor shutting down\n');
      process.exit(1);
    }
  }

  /**
   * Determine if the server should be restarted
   */
  private shouldRestart(): boolean {
    if (this.isShuttingDown) {
      return false;
    }

    // Check restart count within window
    const now = Date.now();
    const recentCrashes = this.crashHistory.filter(
      crash => now - crash.timestamp.getTime() < this.config.restartWindow
    );

    return recentCrashes.length <= this.config.maxRestarts;
  }

  /**
   * Schedule a restart with exponential backoff
   */
  private scheduleRestart(): void {
    this.restartCount++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const backoffDelay = Math.min(1000 * Math.pow(2, this.restartCount - 1), 30000);
    
    logger.info('Scheduling server restart', {
      restartCount: this.restartCount,
      backoffDelay
    });

    process.stderr.write(`[Supervisor] 🔄 Restarting server in ${backoffDelay/1000}s (attempt ${this.restartCount})\n`);

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.startServer();
      }
    }, backoffDelay);
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on the server process
   */
  private performHealthCheck(): void {
    if (!this.serverProcess || this.isShuttingDown) {
      return;
    }

    // Check if process is still running
    try {
      process.kill(this.serverProcess.pid!, 0);
    } catch (error) {
      logger.warn('Health check failed - process not found', {
        pid: this.serverProcess.pid
      });
      this.handleCrash(null, null, 'Health check failed');
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const gracefulShutdown = (signal: string) => {
      logger.info('Received shutdown signal', { signal });
      process.stderr.write(`[Supervisor] 🛑 Received ${signal} - shutting down gracefully\n`);
      this.shutdown();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
  }

  /**
   * Gracefully shutdown the supervisor and server
   */
  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Stop health check
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.serverProcess) {
      logger.info('Shutting down MCP server process', {
        pid: this.serverProcess.pid
      });

      // Try graceful shutdown first
      this.serverProcess.kill('SIGTERM');

      // Force kill if not graceful within timeout
      const forceKillTimer = setTimeout(() => {
        if (this.serverProcess) {
          logger.warn('Force killing server process', {
            pid: this.serverProcess.pid
          });
          this.serverProcess.kill('SIGKILL');
        }
      }, this.config.gracefulShutdownTimeout);

      // Wait for process to exit
      this.serverProcess.on('exit', () => {
        clearTimeout(forceKillTimer);
        logger.info('Server process shut down');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  /**
   * Get supervisor status
   */
  getStatus(): any {
    return {
      serverRunning: !!this.serverProcess,
      serverPid: this.serverProcess?.pid,
      restartCount: this.restartCount,
      crashHistory: this.crashHistory.slice(-5), // Last 5 crashes
      config: this.config,
      uptime: this.serverProcess ? Date.now() - this.lastRestartTime : 0
    };
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const supervisor = new ServerSupervisor();
  
  supervisor.start().catch(error => {
    console.error('Failed to start supervisor:', error);
    process.exit(1);
  });
}

export default ServerSupervisor;