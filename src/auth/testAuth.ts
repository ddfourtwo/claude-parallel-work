#!/usr/bin/env node
/**
 * Test script for Claude Authentication Manager
 * 
 * Run this to verify that the auth system can properly detect
 * your Claude credentials across different platforms.
 */

import { ClaudeAuthManager } from './claudeAuthManager.js';

async function testAuthentication() {
  console.log('🔍 Testing Claude Authentication Manager...\n');
  
  const authManager = new ClaudeAuthManager();
  
  try {
    // Test basic auth token reading
    console.log('1. Testing auth token detection...');
    const tokens = await authManager.readClaudeAuthToken();
    
    if (tokens) {
      console.log('✅ Authentication successful!');
      console.log(`   Source: ${tokens.source}`);
      console.log(`   Type: ${tokens.isApiKey ? 'API Key' : 'OAuth Token'}`);
      console.log(`   Token length: ${tokens.accessToken.length}`);
      if (tokens.expiresAt) {
        console.log(`   Expires: ${tokens.expiresAt}`);
      }
      if (tokens.scopes) {
        console.log(`   Scopes: ${tokens.scopes.join(', ')}`);
      }
    } else {
      console.log('❌ No authentication found');
      console.log('   Please ensure you have either:');
      console.log('   - Logged into Claude Desktop app');
      console.log('   - Set ANTHROPIC_API_KEY environment variable');
      console.log('   - Created a ~/.claude/config.json file');
    }
    
    // Test auth status
    console.log('\n2. Testing auth status...');
    const status = await authManager.getAuthStatus();
    console.log('   Status:', JSON.stringify(status, null, 2));
    
    // Test token validation
    console.log('\n3. Testing token validation...');
    const isValid = await authManager.validateTokens();
    console.log(`   Valid: ${isValid ? '✅' : '❌'}`);
    
    // Test caching
    console.log('\n4. Testing token caching...');
    const start = Date.now();
    await authManager.readClaudeAuthToken(); // Should use cache
    const cacheTime = Date.now() - start;
    console.log(`   Cache lookup time: ${cacheTime}ms (should be < 1ms)`);
    
    // Test cache clearing
    console.log('\n5. Testing cache clearing...');
    authManager.clearCache();
    const start2 = Date.now();
    await authManager.readClaudeAuthToken(); // Should re-read
    const freshTime = Date.now() - start2;
    console.log(`   Fresh lookup time: ${freshTime}ms`);
    
    console.log('\n✅ Authentication manager test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAuthentication();
}

export { testAuthentication };
