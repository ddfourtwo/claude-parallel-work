# Parallel Work CLI - Command Line Interface

## Overview

The `parallel-work` CLI provides a convenient way to manage, monitor, and debug the Parallel Work MCP server from the command line. It offers comprehensive logging capabilities, server management, and troubleshooting tools.

## Installation

The CLI is automatically installed when you run `install.sh`. It's placed in:
- **Linux/macOS**: `~/.local/bin/parallel-work`
- **macOS with Homebrew**: `/usr/local/bin/parallel-work`

## Commands

### 🚀 **Server Management**

#### `parallel-work dashboard`
Launch the visual monitoring dashboard
```bash
parallel-work dashboard
# Opens browser with real-time monitoring interface
```

#### `parallel-work status`
Check server and service status
```bash
parallel-work status
# Shows MCP server status, dashboard status, and port usage
```

#### `parallel-work restart`
Restart the MCP server
```bash
parallel-work restart
# Stops existing services and starts fresh
```

#### `parallel-work stop`
Stop all services
```bash
parallel-work stop
# Gracefully stops MCP server and dashboard
```

#### `parallel-work start`
Start the enhanced server only
```bash
parallel-work start
# Starts MCP server without opening dashboard
```

### 📄 **Logging & Debugging**

#### `parallel-work logs`
View recent server logs (default: last 50 lines)
```bash
parallel-work logs
# Shows recent combined server logs
```

#### `parallel-work logs -f`
Follow server logs in real-time
```bash
parallel-work logs -f
# Streams logs as they happen (Press Ctrl+C to stop)
```

#### `parallel-work logs -e`
View error logs only
```bash
parallel-work logs -e
# Shows only error-level logs
```

#### `parallel-work logs -t 100`
Show specific number of lines
```bash
parallel-work logs -t 100
# Shows last 100 lines instead of default 50
```

#### `parallel-work logs --containers`
View container execution logs
```bash
parallel-work logs --containers
# Lists recent container execution logs with timestamps
```

#### `parallel-work follow`
Follow task execution logs in real-time (simplified task monitoring)
```bash
parallel-work follow
# Streams only task-related activity from server logs
# Filters for: task_worker, task-, Tool invoked, Background execution, Container, Diff, GitDiff
# Press Ctrl+C to stop
```

### ⚙️ **Configuration & Info**

#### `parallel-work config`
Show current configuration
```bash
parallel-work config
# Displays all environment variables from .env file
```

#### `parallel-work version`
Show version and installation info
```bash
parallel-work version
# Shows version, install directory
```

#### `parallel-work health`
Run comprehensive health check
```bash
parallel-work health
# Checks Docker, authentication, dependencies
```

#### `parallel-work help`
Show help message
```bash
parallel-work help
# Shows all available commands and options
```

## Log File Locations

The CLI reads logs from the installation directory:

### Server Logs
- **Combined logs**: `~/mcp-servers/claude-parallel-work/logs/server-combined.log`
- **Error logs**: `~/mcp-servers/claude-parallel-work/logs/server-error.log`

### Container Logs
- **Execution logs**: `~/mcp-servers/claude-parallel-work/logs/*-task-*.log`
- **Format**: `CONTAINER_ID-task-TASK_ID.log`

## Examples

### Debug a Crashed Server
```bash
# Check if server is running
parallel-work status

# View recent errors
parallel-work logs -e

# Follow logs while restarting
parallel-work logs -f &
parallel-work restart
```

### Monitor Long-Running Tasks
```bash
# Follow server logs
parallel-work logs -f

# In another terminal, check container logs
parallel-work logs --containers

# Follow specific container log
tail -f ~/mcp-servers/claude-parallel-work/logs/abc123-task-xyz.log
```

### Troubleshoot Configuration Issues
```bash
# Check current configuration
parallel-work config

# Run health check
parallel-work health

# Check version and paths
parallel-work version
```

### Performance Monitoring
```bash
# Check service status
parallel-work status

# Follow logs to see activity
parallel-work logs -f

# Open dashboard for visual monitoring
parallel-work dashboard
```

## Advanced Usage

### Combining with System Tools

#### Watch for Specific Errors
```bash
parallel-work logs -f | grep -i error
```

#### Count Recent Tasks
```bash
parallel-work logs | grep "Tool invoked: task_worker" | wc -l
```

#### Monitor Resource Usage
```bash
# Server CPU/Memory
ps aux | grep "node.*server\|node.*supervisor"

# Docker containers
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

#### Check Port Usage
```bash
# See what's using port 47821 (MCP server)
lsof -i :47821

# See what's using port 5173 (dashboard)
lsof -i :5173
```

## Troubleshooting

### CLI Command Not Found
```bash
# Check if in PATH
echo $PATH | grep -o "[^:]*bin"

# Add to PATH temporarily
export PATH="$HOME/.local/bin:$PATH"

# Add to shell profile permanently
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### Permission Issues
```bash
# Make CLI executable
chmod +x ~/.local/bin/parallel-work

# Check ownership
ls -la ~/.local/bin/parallel-work
```

### Log File Access
```bash
# Check if log directory exists
ls -la ~/mcp-servers/claude-parallel-work/logs/

# Check log file permissions
ls -la ~/mcp-servers/claude-parallel-work/logs/*.log
```

## Tips

### 🔍 **Quick Debugging**
```bash
# One-liner to check everything
parallel-work status && parallel-work logs -e

# Quick restart if things are broken
parallel-work restart && parallel-work logs -f
```

### 📊 **Development Workflow**
```bash
# Terminal 1: Follow server logs
parallel-work logs -f

# Terminal 2: Work with Claude Code
# (server activity will show in logs)

# Terminal 3: Monitor dashboard
parallel-work dashboard
```

### 🚀 **Production Monitoring**
```bash
# Check health periodically
parallel-work health

# Monitor error trends
parallel-work logs -e | grep "$(date +%Y-%m-%d)"

# Watch for crashes/restarts
parallel-work logs | grep -i "supervisor\|restart\|crash"
```

The CLI provides everything you need to manage, monitor, and debug your Parallel Tasks installation efficiently!