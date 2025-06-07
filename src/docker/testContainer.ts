#!/usr/bin/env node
/**
 * Test script for Container Manager
 * 
 * Tests Docker container pooling, authentication injection,
 * and Claude Code execution in isolated containers.
 */

import { ContainerManager } from './containerManager.js';
import * as path from 'node:path';

async function testContainerManager() {
  console.log('🐳 Testing Container Manager...\n');
  
  const containerManager = new ContainerManager();
  
  try {
    // Test 1: Initialization
    console.log('1. Testing container manager initialization...');
    const startTime = Date.now();
    await containerManager.initialize();
    const initTime = Date.now() - startTime;
    console.log(`✅ Initialized in ${initTime}ms`);
    
    // Test 2: Pool status
    console.log('\n2. Testing pool status...');
    const status = containerManager.getPoolStatus();
    console.log('   Pool status:', status);
    
    // Test 3: Get execution container (fast path)
    console.log('\n3. Testing fast container acquisition...');
    const testWorkspace = process.cwd(); // Use current directory as test workspace
    const container1Start = Date.now();
    const container1 = await containerManager.getExecutionContainer(testWorkspace);
    const container1Time = Date.now() - container1Start;
    console.log(`✅ Got container ${container1.id.substring(0, 12)}... in ${container1Time}ms`);
    console.log(`   Status: ${container1.status}`);
    console.log(`   Auth configured: ${container1.authConfigured}`);
    
    // Test 4: Pool status after container acquisition
    console.log('\n4. Pool status after container acquisition...');
    const status2 = containerManager.getPoolStatus();
    console.log('   Pool status:', status2);
    
    // Test 5: Simple Claude Code execution
    console.log('\n5. Testing Claude Code execution...');
    const execStart = Date.now();
    const result = await containerManager.executeClaudeCode(
      container1, 
      'echo "Hello from Claude Code container!" && pwd && whoami'
    );
    const execTime = Date.now() - execStart;
    
    console.log(`✅ Execution completed in ${execTime}ms`);
    console.log('   Success:', result.success);
    if (result.output) {
      console.log('   Output:', result.output.split('\n').map(line => `     ${line}`).join('\n'));
    }
    if (result.error) {
      console.log('   Error:', result.error);
    }
    
    // Test 6: Get another container (should be fast from pool)
    console.log('\n6. Testing second container acquisition...');
    const container2Start = Date.now();
    const container2 = await containerManager.getExecutionContainer(testWorkspace);
    const container2Time = Date.now() - container2Start;
    console.log(`✅ Got second container ${container2.id.substring(0, 12)}... in ${container2Time}ms`);
    
    // Test 7: Pool status with multiple containers
    console.log('\n7. Pool status with multiple containers in use...');
    const status3 = containerManager.getPoolStatus();
    console.log('   Pool status:', status3);
    
    // Test 8: Release containers
    console.log('\n8. Testing container release...');
    await containerManager.releaseContainer(container1);
    await containerManager.releaseContainer(container2);
    console.log('✅ Released containers back to pool');
    
    // Test 9: Final pool status
    console.log('\n9. Final pool status...');
    const statusFinal = containerManager.getPoolStatus();
    console.log('   Pool status:', statusFinal);
    
    // Test 10: Performance benchmark
    console.log('\n10. Performance benchmark - 3 rapid container acquisitions...');
    const benchmarkStart = Date.now();
    const benchmarkPromises = [];
    
    for (let i = 0; i < 3; i++) {
      benchmarkPromises.push(
        containerManager.getExecutionContainer(testWorkspace)
          .then(container => {
            return containerManager.releaseContainer(container);
          })
      );
    }
    
    await Promise.all(benchmarkPromises);
    const benchmarkTime = Date.now() - benchmarkStart;
    console.log(`✅ 3 containers acquired and released in ${benchmarkTime}ms (avg: ${benchmarkTime / 3}ms per container)`);
    
    console.log('\n✅ Container manager test completed successfully!');
    console.log('\n📊 Performance Summary:');
    console.log(`   - Initialization: ${initTime}ms`);
    console.log(`   - First container: ${container1Time}ms`);
    console.log(`   - Second container: ${container2Time}ms`);
    console.log(`   - Claude execution: ${execTime}ms`);
    console.log(`   - Avg container acquisition: ${benchmarkTime / 3}ms`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Check if it's a Docker-related error
    if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('connect ENOENT'))) {
      console.log('\n💡 Docker doesn\'t seem to be running. Please start Docker and try again.');
    }
    
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    try {
      await containerManager.shutdown();
      console.log('✅ Cleanup completed');
    } catch (cleanupError) {
      console.warn('⚠️ Cleanup warning:', cleanupError);
    }
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testContainerManager();
}

export { testContainerManager };
