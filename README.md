# Claude Parallel Work

Claude Parallel Work is a Model Context Protocol (MCP) server that provides intelligent task breakdown and parallel execution for development projects. It uses containerized isolation and automated dependency analysis to optimize complex workflows.

## Features

- **Parallel task execution** - Break down complex projects into concurrent tasks
- **Docker containerization** - Isolated execution environment for security
- **Intelligent task breakdown** - Automated dependency analysis and optimization
- **Git-based workflow** - Change tracking with diff-based approval process
- **Server persistence** - SQLite-backed state management with automatic recovery

## Roadmap

### 🚀 Upcoming Features

- [ ] **MCP Server Management in Containers** - Enable execution containers to run and manage their own MCP servers for enhanced tool capabilities
  - Support for dynamic MCP server installation in containers
  - Automatic server lifecycle management
  - Pre-configured MCP server bundles for common use cases

- [ ] **Live Dashboard Updates** - Real-time dashboard with enhanced monitoring capabilities
  - Live code diff preview with syntax highlighting
  - Real-time container resource usage graphs
  - Interactive terminal with direct container access for intervening in workers
  - Notifications for task status changes

- [ ] **Improved Developer Experience**
  - VS Code extension for direct integration
  - Task execution history and analytics
  - Performance profiling and optimization suggestions

## Installation

### 1. Install
```bash
git clone https://github.com/ddfourtwo/claude-parallel-work
cd claude-parallel-work
chmod +x install.sh
./install.sh
```

### 2. Task Planning
 - Use the installed custom slash commands to generate a tasks.json file: /break-down-to-work-plan and /work-plan-from-doc

### 3. Usage
 - Use the installed custom slash commands to kick off orchestration: /orchestrate-tasks

The server provides MCP tools for task management:
- `get_next_tasks` - Get next tasks to work on
- `task_worker` - Execute development tasks in containers
- `review_changes` - Inspect modifications before applying
- `apply_changes` - Apply approved changes to workspace


## Prerequisites

- **Node.js v20+** 
- **Docker** (Docker Desktop or Engine)
- **Git repository** (working directories must be git repos)
- **MCP Client** (Claude Desktop, Cursor, Windsurf, etc.)

## Dashboard

The monitoring interface provides real-time visibility into task execution:

```bash
parallel-work dashboard    # Launch dashboard
parallel-work status       # Check service status
parallel-work logs -f      # View server logs
parallel-work follow       # Monitor task execution
```

Features:
- Repository and task status monitoring
- Container log streaming with terminal interface
- Change diff management and preview
- Live progress updates via WebSocket

## CLI Reference

```bash
# Service management
parallel-work status       # Check if services are running
parallel-work restart      # Restart crashed server
parallel-work dashboard    # Launch monitoring interface

# Monitoring & debugging  
parallel-work logs         # View recent logs
parallel-work logs -f      # Follow logs in real-time
parallel-work follow       # Follow task execution
parallel-work health       # Run health check

# Configuration
parallel-work config       # Show current config
parallel-work version      # Show version info
```

## Development

```bash
# Build and test
npm run build
npm test

# Development mode
npm run dev

# Dashboard development
npm run dashboard          # Start dashboard dev server
npm run start:dashboard    # Start enhanced server
```

## Documentation

- **[CLI Usage Guide](docs/CLI_USAGE.md)** - Complete CLI reference
- **[Known Issues](docs/KNOWN_ISSUES.md)** - Troubleshooting guide
- **[Git Diff Troubleshooting](docs/GIT_DIFF_TROUBLESHOOTING.md)** - Debug git diff issues
- **[Server Resilience](docs/SERVER_RESILIENCE_IMPLEMENTATION.md)** - Persistence features
- **[Server Supervisor](docs/SERVER_SUPERVISOR.md)** - Auto-restart configuration

## Workflow

1. **Get Open Tasks**: `get_next_tasks`
2. **Monitor progress**: `work_status taskId="task-123"`
3. **Review changes**: `review_changes diffId="diff-456"`
4. **Apply changes**: `apply_changes diffId="diff-456" targetWorkspace="/project"`
5. **Continue**: `get_next_tasks workFolder="/project"`

## Troubleshooting

**Server won't start?**
```bash
parallel-work health       # Check prerequisites
parallel-work logs -e      # Check error logs
```

**Tasks timing out?**
```bash
parallel-work follow       # Monitor task execution
view_container_logs identifier="task-123"
```

**Git diff issues?**
See [Git Diff Troubleshooting](docs/GIT_DIFF_TROUBLESHOOTING.md)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test it yourself!
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

