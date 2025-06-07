/**
 * Supervisor Configuration
 * 
 * Loads configuration from environment variables and provides defaults
 */

export interface SupervisorConfig {
  maxRestarts: number;
  restartWindow: number; // Time window in milliseconds
  gracefulShutdownTimeout: number;
  healthCheckInterval: number;
  logCrashes: boolean;
  enabled: boolean;
}

/**
 * Load supervisor configuration from environment variables
 */
export function loadSupervisorConfig(): SupervisorConfig {
  return {
    enabled: process.env.MCP_SUPERVISOR_MODE !== 'false',
    maxRestarts: parseInt(process.env.MCP_SUPERVISOR_MAX_RESTARTS || '10', 10),
    restartWindow: parseInt(process.env.MCP_SUPERVISOR_RESTART_WINDOW || '60000', 10), // 1 minute
    gracefulShutdownTimeout: parseInt(process.env.MCP_SUPERVISOR_SHUTDOWN_TIMEOUT || '30000', 10), // 30 seconds
    healthCheckInterval: parseInt(process.env.MCP_SUPERVISOR_HEALTH_INTERVAL || '5000', 10), // 5 seconds
    logCrashes: process.env.MCP_SUPERVISOR_LOG_CRASHES !== 'false'
  };
}

/**
 * Validate supervisor configuration
 */
export function validateSupervisorConfig(config: SupervisorConfig): void {
  if (config.maxRestarts < 1) {
    throw new Error('maxRestarts must be at least 1');
  }
  
  if (config.restartWindow < 1000) {
    throw new Error('restartWindow must be at least 1000ms');
  }
  
  if (config.gracefulShutdownTimeout < 1000) {
    throw new Error('gracefulShutdownTimeout must be at least 1000ms');
  }
  
  if (config.healthCheckInterval < 1000) {
    throw new Error('healthCheckInterval must be at least 1000ms');
  }
}