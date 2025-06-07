/**
 * Winston Logger Configuration
 * Provides centralized logging for server operations, errors, and debugging
 */

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Check if we're running in MCP mode (stdout is used for protocol communication)
const isMcpMode = !process.stdout.isTTY;

// Custom format for better readability
const customFormat = winston.format.printf(({ timestamp, level, message, ...metadata }: any) => {
  let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  // Add metadata if present
  if (Object.keys(metadata).length > 0) {
    // Handle errors specially
    if (metadata.error && metadata.stack) {
      msg += `\n  Error: ${metadata.error}\n  Stack: ${metadata.stack}`;
      delete metadata.error;
      delete metadata.stack;
    }
    
    // Add remaining metadata
    if (Object.keys(metadata).length > 0) {
      msg += `\n  Metadata: ${JSON.stringify(metadata, null, 2)}`;
    }
  }
  
  return msg;
});

// Create the logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  transports: [
    // Error logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'server-error.log'), 
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Combined logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'server-combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Console output (disabled in MCP mode to prevent JSON protocol contamination)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      silent: process.env.NODE_ENV === 'test' || isMcpMode
    })
  ]
});

// Add process error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { 
    error: error.message, 
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  // Give logger time to write
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { 
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise),
    timestamp: new Date().toISOString()
  });
});

// Log startup (only to files when in MCP mode)
if (!isMcpMode) {
  logger.info('Logger initialized', {
    logLevel: process.env.LOG_LEVEL || 'info',
    logsDirectory: logsDir,
    nodeEnv: process.env.NODE_ENV
  });
} else {
  // Just write to log files when in MCP mode
  const fileLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      customFormat
    ),
    transports: [
      new winston.transports.File({ 
        filename: path.join(logsDir, 'server-combined.log'),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        tailable: true
      })
    ]
  });
  
  fileLogger.info('Logger initialized (MCP mode)', {
    logLevel: process.env.LOG_LEVEL || 'info',
    logsDirectory: logsDir,
    mcpMode: true
  });
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: string) {
  return logger.child({ context });
}

/**
 * Wrap a tool handler with logging
 */
export function wrapToolHandler(toolName: string, handler: Function) {
  return async (...args: any[]) => {
    const startTime = Date.now();
    const requestId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    logger.info(`Tool invoked: ${toolName}`, { 
      toolName,
      requestId,
      args: JSON.stringify(args).substring(0, 1000) // Truncate large args
    });
    
    try {
      const result = await handler(...args);
      
      logger.info(`Tool completed: ${toolName}`, { 
        toolName,
        requestId,
        duration: Date.now() - startTime,
        success: true 
      });
      
      return result;
    } catch (error) {
      logger.error(`Tool failed: ${toolName}`, { 
        toolName,
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        args: JSON.stringify(args).substring(0, 1000),
        duration: Date.now() - startTime 
      });
      throw error;
    }
  };
}

export default logger;