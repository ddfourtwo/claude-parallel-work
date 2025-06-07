#!/usr/bin/env node
/**
 * Health Check for Claude Parallel Work
 * 
 * Comprehensive system diagnostics to verify all components are properly configured
 */

import Docker from 'dockerode';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface HealthCheckResult {
  component: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string[];
  fix?: string;
}

class HealthChecker {
  private results: HealthCheckResult[] = [];
  
  async runAllChecks(): Promise<void> {
    console.log('🏥 Claude Parallel Work Health Check\n');
    
    // Run all checks
    await this.checkNodeVersion();
    await this.checkDocker();
    await this.checkDockerPermissions();
    await this.checkDockerImage();
    await this.checkProjectStructure();
    await this.checkGitInstallation();
    await this.checkAnthropicApiKey();
    await this.checkPortAvailability();
    await this.checkDiskSpace();
    
    // Display results
    this.displayResults();
  }
  
  private async checkNodeVersion(): Promise<void> {
    try {
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
      
      if (majorVersion >= 20) {
        this.results.push({
          component: 'Node.js',
          status: 'pass',
          message: `Version ${nodeVersion} installed`,
          details: ['Node.js 20+ is required']
        });
      } else {
        this.results.push({
          component: 'Node.js',
          status: 'fail',
          message: `Version ${nodeVersion} is too old`,
          details: ['Node.js 20+ is required'],
          fix: 'Install Node.js 20 or higher using nvm or fnm'
        });
      }
    } catch (error) {
      this.results.push({
        component: 'Node.js',
        status: 'fail',
        message: 'Failed to check Node.js version',
        details: [error instanceof Error ? error.message : 'Unknown error']
      });
    }
  }
  
  private async checkDocker(): Promise<void> {
    try {
      // Try different Docker socket paths
      const socketPaths = [
        process.env.DOCKER_HOST?.replace('unix://', ''),
        '/var/run/docker.sock',
        `${process.env.HOME}/.colima/default/docker.sock`,
        `${process.env.HOME}/.docker/run/docker.sock`
      ].filter(Boolean) as string[];
      
      let docker: Docker | null = null;
      let workingPath: string | null = null;
      
      for (const socketPath of socketPaths) {
        if (existsSync(socketPath)) {
          try {
            const testDocker = new Docker({ socketPath });
            await testDocker.ping();
            docker = testDocker;
            workingPath = socketPath;
            break;
          } catch {
            // Try next path
          }
        }
      }
      
      if (!docker) {
        // Try default Docker connection
        try {
          docker = new Docker();
          await docker.ping();
          workingPath = 'default';
        } catch (error) {
          throw new Error('Docker is not accessible');
        }
      }
      
      // Get Docker version
      const version = await docker.version();
      
      this.results.push({
        component: 'Docker',
        status: 'pass',
        message: `Docker ${version.Version} is running`,
        details: [
          `API Version: ${version.ApiVersion}`,
          `OS/Arch: ${version.Os}/${version.Arch}`,
          workingPath !== 'default' ? `Socket: ${workingPath}` : 'Using default Docker socket'
        ]
      });
      
    } catch (error) {
      this.results.push({
        component: 'Docker',
        status: 'fail',
        message: 'Docker is not accessible',
        details: [
          error instanceof Error ? error.message : 'Unknown error',
          'Docker must be installed and running'
        ],
        fix: `
1. Install Docker:
   - macOS/Windows: Download Docker Desktop from docker.com
   - Linux: sudo apt-get install docker.io (Ubuntu) or equivalent

2. Start Docker:
   - macOS/Windows: Launch Docker Desktop
   - Linux: sudo systemctl start docker

3. Verify: docker ps`
      });
    }
  }
  
  private async checkDockerPermissions(): Promise<void> {
    try {
      const { stdout } = await execAsync('docker ps');
      this.results.push({
        component: 'Docker Permissions',
        status: 'pass',
        message: 'User has Docker access',
        details: ['Can execute Docker commands without sudo']
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      
      if (errorMsg.includes('permission denied')) {
        this.results.push({
          component: 'Docker Permissions',
          status: 'fail',
          message: 'User lacks Docker permissions',
          details: ['Cannot run Docker commands without sudo'],
          fix: `
Linux users:
1. Add user to docker group: sudo usermod -aG docker $USER
2. Log out and log back in
3. Verify: docker ps

macOS/Windows: Ensure Docker Desktop is running`
        });
      } else {
        // Docker check already failed, skip this
      }
    }
  }
  
  private async checkDockerImage(): Promise<void> {
    try {
      // Try different Docker socket paths
      const socketPaths = [
        process.env.DOCKER_HOST?.replace('unix://', ''),
        '/var/run/docker.sock',
        `${process.env.HOME}/.colima/default/docker.sock`,
        `${process.env.HOME}/.docker/run/docker.sock`
      ].filter(Boolean) as string[];
      
      let docker: Docker | null = null;
      
      for (const socketPath of socketPaths) {
        if (existsSync(socketPath)) {
          try {
            const testDocker = new Docker({ socketPath });
            await testDocker.ping();
            docker = testDocker;
            break;
          } catch {
            // Try next path
          }
        }
      }
      
      if (!docker) {
        // Try default Docker connection
        try {
          docker = new Docker();
          await docker.ping();
        } catch {
          // Docker not available, skip this check
          return;
        }
      }
      
      const images = await docker.listImages();
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.includes('claude-execution-anthropic:latest')
      );
      
      if (imageExists) {
        // Get image details
        const image = images.find(img => 
          img.RepoTags && img.RepoTags.includes('claude-execution-anthropic:latest')
        );
        
        const details = ['claude-execution-anthropic:latest exists'];
        if (image) {
          const size = (image.Size / 1024 / 1024).toFixed(2);
          details.push(`Size: ${size} MB`);
          
          // Check image age
          const created = new Date(image.Created * 1000);
          const ageInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
          details.push(`Created: ${ageInDays} days ago`);
        }
        
        this.results.push({
          component: 'Docker Image',
          status: 'pass',
          message: 'Claude execution image is built',
          details
        });
      } else {
        this.results.push({
          component: 'Docker Image',
          status: 'warning',
          message: 'Claude execution image not built',
          details: ['Image will be built on first run (takes 2-3 minutes)'],
          fix: 'The image will be automatically built when you first use task_worker'
        });
      }
    } catch (error) {
      // Docker not available or error occurred, skip this check
      if (error instanceof Error && error.message.includes('EACCES')) {
        this.results.push({
          component: 'Docker Image',
          status: 'fail',
          message: 'Cannot access Docker to check images',
          details: ['Permission denied when accessing Docker'],
          fix: 'Fix Docker permissions first'
        });
      }
    }
  }
  
  private async checkProjectStructure(): Promise<void> {
    const requiredPaths = [
      'docker/claude-execution/Dockerfile',
      'docker/claude-execution/Dockerfile.anthropic',
      'src/server.ts',
      'package.json'
    ];
    
    const missingPaths: string[] = [];
    
    for (const reqPath of requiredPaths) {
      const fullPath = path.join(process.cwd(), reqPath);
      if (!existsSync(fullPath)) {
        missingPaths.push(reqPath);
      }
    }
    
    if (missingPaths.length === 0) {
      this.results.push({
        component: 'Project Structure',
        status: 'pass',
        message: 'All required files present',
        details: ['Docker configuration and source files found']
      });
    } else {
      this.results.push({
        component: 'Project Structure',
        status: 'fail',
        message: 'Missing required files',
        details: missingPaths.map(p => `Missing: ${p}`),
        fix: 'Ensure you are running from the claude-parallel-work directory'
      });
    }
  }
  
  private async checkGitInstallation(): Promise<void> {
    try {
      const { stdout } = await execAsync('git --version');
      this.results.push({
        component: 'Git',
        status: 'pass',
        message: stdout.trim(),
        details: ['Git is required for change tracking']
      });
    } catch {
      this.results.push({
        component: 'Git',
        status: 'fail',
        message: 'Git is not installed',
        details: ['Git is required for tracking changes in containers'],
        fix: 'Install Git from git-scm.com or via package manager'
      });
    }
  }
  
  private async checkAnthropicApiKey(): Promise<void> {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    
    if (hasKey) {
      this.results.push({
        component: 'Anthropic API Key',
        status: 'pass',
        message: 'API key is configured',
        details: ['ANTHROPIC_API_KEY environment variable is set']
      });
    } else {
      this.results.push({
        component: 'Anthropic API Key',
        status: 'warning',
        message: 'API key not found in environment',
        details: ['ANTHROPIC_API_KEY environment variable is not set'],
        fix: 'Set ANTHROPIC_API_KEY in your environment or MCP client configuration'
      });
    }
  }
  
  private async checkPortAvailability(): Promise<void> {
    const streamPort = parseInt(process.env.CLAUDE_PARALLEL_STREAM_PORT || '47821');
    const dashboardPort = 5173;
    
    interface PortInfo {
      inUse: boolean;
      processName?: string;
      pid?: string;
      isClaudeParallel?: boolean;
    }
    
    const checkPort = async (port: number): Promise<PortInfo> => {
      try {
        // Try lsof first (more detailed info)
        const { stdout: lsofOut } = await execAsync(`lsof -i :${port} -P -n 2>/dev/null || echo ""`);
        
        if (lsofOut && lsofOut.trim() !== '') {
          const lines = lsofOut.trim().split('\n');
          if (lines.length > 1) {
            // Parse lsof output
            const dataLine = lines[1]; // First line is header
            const parts = dataLine.split(/\s+/);
            const processName = parts[0] || 'unknown';
            const pid = parts[1] || 'unknown';
            
            // Get detailed process info using ps command
            let isClaudeParallel = false;
            try {
              const { stdout: psOut } = await execAsync(`ps -p ${pid} -o command= 2>/dev/null || echo ""`);
              const commandLine = psOut.trim();
              
              // Check if it's our process by looking at the command line
              isClaudeParallel = processName === 'node' && (
                commandLine.includes('claude-parallel-work/dist/server.js') ||
                commandLine.includes('start:dashboard') ||
                commandLine.includes('ENABLE_DASHBOARD=true') ||
                commandLine.includes('vite') && commandLine.includes('dashboard') ||
                commandLine.includes('claude-parallel-work')
              );
              
              // Also check parent process for npm scripts
              if (!isClaudeParallel && processName === 'node') {
                try {
                  const { stdout: ppidOut } = await execAsync(`ps -p ${pid} -o ppid= 2>/dev/null || echo ""`);
                  const ppid = ppidOut.trim();
                  if (ppid) {
                    const { stdout: parentOut } = await execAsync(`ps -p ${ppid} -o command= 2>/dev/null || echo ""`);
                    const parentCommand = parentOut.trim();
                    isClaudeParallel = parentCommand.includes('npm') && (
                      parentCommand.includes('start:dashboard') ||
                      parentCommand.includes('dashboard')
                    );
                  }
                } catch {
                  // Ignore parent process check errors
                }
              }
            } catch {
              // If we can't get process details, make a best guess
              isClaudeParallel = false;
            }
            
            return {
              inUse: true,
              processName,
              pid,
              isClaudeParallel
            };
          }
        }
        
        // Fallback to netstat if lsof didn't work
        const { stdout: netstatOut } = await execAsync(`netstat -an | grep ":${port}" | grep LISTEN || echo ""`);
        
        if (netstatOut && netstatOut.trim() !== '') {
          // Port is in use but we can't determine the process
          return {
            inUse: true,
            processName: 'unknown',
            pid: 'unknown',
            isClaudeParallel: false
          };
        }
        
        return { inUse: false };
      } catch {
        // If both commands fail, assume port is free
        return { inUse: false };
      }
    };
    
    const streamPortInfo = await checkPort(streamPort);
    const dashboardPortInfo = await checkPort(dashboardPort);
    
    const details: string[] = [];
    let status: 'pass' | 'warning' | 'fail' = 'pass';
    let fix: string | undefined;
    
    // Check streaming port
    if (!streamPortInfo.inUse) {
      details.push(`✅ Port ${streamPort} (streaming) is available`);
    } else if (streamPortInfo.isClaudeParallel) {
      details.push(`✅ Port ${streamPort} (streaming) is in use by Claude Parallel Work`);
      details.push(`   Process: ${streamPortInfo.processName} (PID: ${streamPortInfo.pid})`);
    } else {
      status = 'warning';
      details.push(`⚠️ Port ${streamPort} (streaming) is in use by another process`);
      details.push(`   Process: ${streamPortInfo.processName} (PID: ${streamPortInfo.pid})`);
      fix = `Port ${streamPort} is occupied by another process. Either:\n` +
            `1. Stop the process using: kill ${streamPortInfo.pid}\n` +
            `2. Set CLAUDE_PARALLEL_STREAM_PORT to a different port`;
    }
    
    // Check dashboard port
    if (!dashboardPortInfo.inUse) {
      details.push(`✅ Port ${dashboardPort} (dashboard) is available`);
    } else if (dashboardPortInfo.isClaudeParallel) {
      details.push(`✅ Port ${dashboardPort} (dashboard) is in use by Claude Parallel Work`);
      details.push(`   Process: ${dashboardPortInfo.processName} (PID: ${dashboardPortInfo.pid})`);
    } else {
      if (status === 'pass') status = 'warning';
      details.push(`⚠️ Port ${dashboardPort} (dashboard) is in use by another process`);
      details.push(`   Process: ${dashboardPortInfo.processName} (PID: ${dashboardPortInfo.pid})`);
      if (!fix) {
        fix = `Port ${dashboardPort} is occupied. Stop the process using: kill ${dashboardPortInfo.pid}`;
      } else {
        fix += `\nPort ${dashboardPort} is also occupied. Stop using: kill ${dashboardPortInfo.pid}`;
      }
    }
    
    this.results.push({
      component: 'Network Ports',
      status,
      message: 'Port availability and ownership checked',
      details,
      fix
    });
  }
  
  private async checkDiskSpace(): Promise<void> {
    try {
      const { stdout } = await execAsync('df -h /var/lib/docker 2>/dev/null || df -h /');
      const lines = stdout.trim().split('\n');
      const dataLine = lines[lines.length - 1];
      const parts = dataLine.split(/\s+/);
      const percentUsed = parseInt(parts[4]);
      
      if (percentUsed < 90) {
        this.results.push({
          component: 'Disk Space',
          status: 'pass',
          message: `${100 - percentUsed}% free space available`,
          details: [`Docker storage: ${parts[3]} available`]
        });
      } else {
        this.results.push({
          component: 'Disk Space',
          status: 'warning',
          message: `Only ${100 - percentUsed}% free space remaining`,
          details: ['Docker may run out of space for containers'],
          fix: 'Free up disk space or run: docker system prune'
        });
      }
    } catch {
      // Skip disk check on error
    }
  }
  
  private displayResults(): void {
    console.log('\n📋 Health Check Results:\n');
    
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warnings = this.results.filter(r => r.status === 'warning').length;
    
    for (const result of this.results) {
      const icon = result.status === 'pass' ? '✅' : 
                   result.status === 'fail' ? '❌' : '⚠️';
      
      console.log(`${icon} ${result.component}: ${result.message}`);
      
      if (result.details && result.details.length > 0) {
        for (const detail of result.details) {
          console.log(`   ${detail}`);
        }
      }
      
      if (result.fix) {
        console.log(`\n   💡 Fix: ${result.fix}`);
      }
      
      console.log('');
    }
    
    console.log('📊 Summary:');
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⚠️  Warnings: ${warnings}`);
    
    if (failed === 0) {
      console.log('\n🎉 All critical components are working!');
      if (warnings > 0) {
        console.log('   Some warnings exist but won\'t prevent operation.');
      }
    } else {
      console.log('\n⚠️  Please fix the failed components for full functionality.');
      console.log('   Basic features will work, but Docker-dependent features are disabled.');
    }
  }
}

// Run health check if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new HealthChecker();
  checker.runAllChecks().catch(console.error);
}

export { HealthChecker };