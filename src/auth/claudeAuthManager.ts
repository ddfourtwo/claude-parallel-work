#!/usr/bin/env node
/**
 * Cross-Platform Claude Authentication Manager
 * 
 * Based on claude-code-router authentication patterns, this module handles
 * Claude Code authentication across macOS, Linux, and Windows platforms.
 * 
 * Supports:
 * - macOS Keychain (Claude Code-credentials)
 * - Linux Secret Service (GNOME Keyring)
 * - Windows Credential Manager
 * - Environment variables (ANTHROPIC_API_KEY)
 * - Claude config files
 */

import { execSync } from 'child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Debug logging function (matches claude-parallel-work pattern)
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';
function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error('[Auth]', message, ...optionalParams);
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  source: 'keychain' | 'secret-service' | 'credential-manager' | 'config-file' | 'env';
  isApiKey: boolean;
  expiresAt?: string;
  scopes?: string[];
}

export class ClaudeAuthManager {
  private tokenCache: AuthTokens | null = null;
  private cacheExpiry: number = 0;
  private readonly cacheTTL = 300000; // 5 minutes cache

  /**
   * Read Claude auth token from various sources, prioritizing platform-specific secure storage.
   * Based on claude-code-router patterns with cross-platform extensions.
   */
  async readClaudeAuthToken(): Promise<AuthTokens | null> {
    // Check cache first
    if (this.tokenCache && Date.now() < this.cacheExpiry) {
      debugLog('Using cached auth tokens');
      return this.tokenCache;
    }

    try {
      // Try environment variable first (universal)
      if (process.env.ANTHROPIC_API_KEY) {
        const key = process.env.ANTHROPIC_API_KEY;
        debugLog('Found API key in environment variable ANTHROPIC_API_KEY');
        debugLog(`Key: ${key.substring(0, 10)}...${key.substring(key.length - 5)} (length: ${key.length})`);
        
        const tokens: AuthTokens = {
          accessToken: key,
          refreshToken: undefined,
          source: 'env',
          isApiKey: true
        };
        
        this.cacheTokens(tokens);
        return tokens;
      }

      // Platform-specific credential retrieval
      const platform = process.platform;
      let tokens: AuthTokens | null = null;

      // Platform-specific credential retrieval
      switch (platform) {
        case 'darwin':
          tokens = await this.getTokensFromMacOSKeychain();
          break;
        case 'linux':
          tokens = await this.getTokensFromLinuxSecretService();
          break;
        case 'win32':
          tokens = await this.getTokensFromWindowsCredManager();
          break;
        default:
          debugLog(`Unsupported platform: ${platform}, falling back to config file`);
          tokens = await this.getTokensFromClaudeConfigFile();
          break;
      }

      if (tokens) {
        this.cacheTokens(tokens);
        return tokens;
      }

      // Always fallback to config file if platform-specific methods failed
      debugLog('Platform-specific method returned null, trying config file...');
      tokens = await this.getTokensFromClaudeConfigFile();
      if (tokens) {
        this.cacheTokens(tokens);
        return tokens;
      }

      debugLog('No Claude credentials found in any location');
      return null;

    } catch (error) {
      console.error('Error reading Claude auth token:', error);
      return null;
    }
  }

  /**
   * Retrieves tokens from macOS Keychain for "Claude Code-credentials".
   * Direct adaptation from claude-code-router implementation.
   */
  private async getTokensFromMacOSKeychain(): Promise<AuthTokens | null> {
    try {
      const username = os.userInfo().username;
      if (!username) {
        debugLog('Could not determine username to query Keychain');
        return null;
      }

      // Try multiple possible keychain entries
      const keychainEntries = [
        { service: 'Claude Code-credentials', account: username }
        
      ];
      
      let tokenJsonString = '';
      
      for (const entry of keychainEntries) {
        try {
          const command = `security find-generic-password -s "${entry.service}" -a "${entry.account}" -w`;
          tokenJsonString = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
          if (tokenJsonString) {
            debugLog(`Found credentials in keychain: service="${entry.service}", account="${entry.account}"`);
            break;
          }
        } catch (e) {
          // This is expected if the keychain entry doesn't exist
          debugLog(`Keychain entry not found for service="${entry.service}", account="${entry.account}"`);
          // Continue to next entry
        }
      }

      if (tokenJsonString) {
        debugLog('Raw token string length:', tokenJsonString.length);
        
        let tokenData;
        try {
          tokenData = JSON.parse(tokenJsonString);
        } catch (parseError) {
          debugLog('Failed to parse token JSON:', parseError);
          debugLog('Token string preview:', tokenJsonString.substring(0, 100));
          return null;
        }
        
        if (tokenData.claudeAiOauth && tokenData.claudeAiOauth.accessToken) {
          
          // Check for token expiration
          if (tokenData.claudeAiOauth.expiresAt) {
            const expiresAt = new Date(tokenData.claudeAiOauth.expiresAt);
            const now = new Date();
            if (expiresAt < now) {
              console.warn('⚠️ Tokens from Keychain (Claude Code-credentials) have expired.');
              return null;
            }
          }
          
          debugLog('Successfully retrieved tokens from macOS Keychain (Claude Code-credentials)');
          return {
            accessToken: tokenData.claudeAiOauth.accessToken,
            refreshToken: tokenData.claudeAiOauth.refreshToken,
            expiresAt: tokenData.claudeAiOauth.expiresAt,
            scopes: tokenData.claudeAiOauth.scopes,
            source: 'keychain',
            isApiKey: false
          };
        }
      }
      return null;
    } catch (error) {
      debugLog('Could not retrieve tokens from Keychain (Claude Code-credentials). This is normal if not set up.');
      return null;
    }
  }

  /**
   * Retrieves tokens from Linux Secret Service (GNOME Keyring/libsecret).
   */
  private async getTokensFromLinuxSecretService(): Promise<AuthTokens | null> {
    try {
      // Try secret-tool (GNOME Keyring/libsecret)
      const username = os.userInfo().username;
      const command = `secret-tool lookup service "Claude Code" username "${username}"`;
      const tokenJsonString = execSync(command, { encoding: 'utf8' }).trim();
      
      if (tokenJsonString) {
        const tokenData = JSON.parse(tokenJsonString);
        debugLog('Successfully retrieved tokens from Linux Secret Service');
        return {
          accessToken: tokenData.claudeAiOauth?.accessToken || tokenData.accessToken,
          refreshToken: tokenData.claudeAiOauth?.refreshToken,
          expiresAt: tokenData.claudeAiOauth?.expiresAt,
          source: 'secret-service',
          isApiKey: false
        };
      }
    } catch (error) {
      debugLog('Linux secret service lookup failed:', error);
    }
    
    // Fallback to config file
    return await this.getTokensFromClaudeConfigFile();
  }

  /**
   * Retrieves tokens from Windows Credential Manager.
   */
  private async getTokensFromWindowsCredManager(): Promise<AuthTokens | null> {
    try {
      // Use PowerShell to access Windows Credential Manager
      const command = `powershell -Command "Get-StoredCredential -Target 'Claude Code' | ConvertTo-Json"`;
      const result = execSync(command, { encoding: 'utf8' }).trim();
      
      if (result) {
        const credData = JSON.parse(result);
        debugLog('Successfully retrieved tokens from Windows Credential Manager');
        return {
          accessToken: credData.Password,
          source: 'credential-manager',
          isApiKey: false
        };
      }
    } catch (error) {
      debugLog('Windows Credential Manager lookup failed:', error);
    }
    
    return await this.getTokensFromClaudeConfigFile();
  }

  /**
   * Retrieves tokens from Claude config files in standard locations.
   */
  private async getTokensFromClaudeConfigFile(): Promise<AuthTokens | null> {
    debugLog('getTokensFromClaudeConfigFile called');
    try {
      // Check standard Claude config locations
      const configPaths = [
        path.join(os.homedir(), '.claude', '.credentials.json'), // Claude CLI credentials
        path.join(os.homedir(), '.claude', 'credentials.json'),
        path.join(os.homedir(), '.claude', 'config.json'),
        path.join(os.homedir(), '.config', 'claude', 'config.json'),
        path.join(os.homedir(), '.claude.json'), // Legacy location
      ];
      
      for (const configPath of configPaths) {
        debugLog(`Checking for config file: ${configPath}`);
        if (existsSync(configPath)) {
          debugLog(`Found config file: ${configPath}`);
          const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
          
          if (configData.claudeAiOauth?.accessToken) {
            debugLog(`Successfully retrieved tokens from config file: ${configPath}`);
            return {
              accessToken: configData.claudeAiOauth.accessToken,
              refreshToken: configData.claudeAiOauth.refreshToken,
              expiresAt: configData.claudeAiOauth.expiresAt,
              scopes: configData.claudeAiOauth.scopes,
              source: 'config-file',
              isApiKey: false
            };
          }
        }
      }
    } catch (error) {
      debugLog('Config file lookup failed:', error);
    }
    
    return null;
  }

  /**
   * Cache tokens in memory with TTL.
   */
  private cacheTokens(tokens: AuthTokens): void {
    this.tokenCache = tokens;
    this.cacheExpiry = Date.now() + this.cacheTTL;
    debugLog(`Cached auth tokens from ${tokens.source} for ${this.cacheTTL / 1000}s`);
  }

  /**
   * Clear cached tokens (useful for testing or token refresh).
   */
  clearCache(): void {
    this.tokenCache = null;
    this.cacheExpiry = 0;
    debugLog('Cleared auth token cache');
  }

  /**
   * Get authentication status for health checks.
   */
  async getAuthStatus(): Promise<{
    authenticated: boolean;
    source?: string;
    isApiKey?: boolean;
    expiresAt?: string;
    tokenLength?: number;
  }> {
    const tokens = await this.readClaudeAuthToken();
    
    if (!tokens) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      source: tokens.source,
      isApiKey: tokens.isApiKey,
      expiresAt: tokens.expiresAt,
      tokenLength: tokens.accessToken.length
    };
  }

  /**
   * Validate that tokens are not expired and functional.
   */
  async validateTokens(): Promise<boolean> {
    const tokens = await this.readClaudeAuthToken();
    
    if (!tokens) {
      return false;
    }

    // Check expiration for OAuth tokens
    if (tokens.expiresAt) {
      const expiresAt = new Date(tokens.expiresAt);
      const now = new Date();
      
      if (expiresAt < now) {
        debugLog('Tokens have expired');
        this.clearCache(); // Clear expired tokens from cache
        return false;
      }
    }

    return true;
  }
}
