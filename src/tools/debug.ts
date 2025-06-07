/**
 * Debug logging utility
 */

const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';

export function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error('[DEBUG]', message, ...optionalParams);
  }
}