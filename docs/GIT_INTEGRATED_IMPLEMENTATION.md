# Git-Integrated Claude Code Implementation

## Overview

This document describes the final Git-integrated implementation that replaces the complex worktree-based approach with a simpler, more reliable solution using Git inside Docker containers.

## Architecture

### Core Components

1. **GitContainerDiffManager** (`src/tools/git-container-diff-manager.ts`)
   - Manages Git operations inside Docker containers
   - Initializes Git repositories with proper configuration
   - Extracts comprehensive diffs after execution
   - Handles patch generation and statistics

2. **GitDiffIntegration** (`src/tools/git-diff-integration.ts`)
   - High-level integration layer for diff management
   - Stores and manages extracted diffs
   - Provides diff review and application functionality
   - Handles patch validation and error recovery

3. **GitIntegratedClaudeCodeManager** (`src/tools/claude-code-git-integrated.ts`)
   - Main execution manager replacing worktree-based approach
   - Handles synchronous and background task execution
   - Manages container lifecycle and diff extraction
   - Determines when manual review is required

4. **Enhanced Container Manager** (`src/docker/containerManager.ts`)
   - Updated to automatically initialize Git in containers
   - Provides container pooling for performance
   - Exposes `extractGitDiff()` method
   - Manages authentication and workspace setup

## How It Works

### Execution Flow

1. **Container Creation**
   ```javascript
   const container = await containerManager.createReadOnlyContainer(
     workspacePath,
     config,
     taskId
   );
   ```
   - Container is created with workspace mounted read/write
   - Git is automatically initialized inside the container

2. **Git Initialization** (Automatic)
   ```bash
   # Inside container
   git config --global user.email "claude@container.local"
   git config --global user.name "Claude Container"
   git config --global --add safe.directory /workspace
   git init
   git add -A
   git commit -m "Initial container state"
   ```

3. **Claude Code Execution**
   - Claude Code runs inside the container
   - All file modifications happen in the mounted workspace
   - Git tracks every change

4. **Diff Extraction**
   ```javascript
   const diffResult = await containerManager.extractGitDiff(container);
   ```
   - Stages all changes: `git add -A`
   - Generates comprehensive diff: `git diff --cached`
   - Extracts statistics and file information

5. **Review Process**
   - Diff is formatted for human review
   - Shows files changed, additions, deletions
   - Sensitive changes require manual approval

6. **Application**
   ```javascript
   await gitDiffIntegration.applyDiff(diffId, targetWorkspace);
   ```
   - Validates patch with `git apply --check`
   - Applies changes atomically
   - Falls back to `patch` command if needed

## Key Benefits

### Over Worktree Approach

1. **Simplicity**
   - No complex Git worktree management
   - No worktree naming conflicts
   - Cleaner codebase

2. **Reliability**
   - Git inside container tracks ALL changes
   - Works with any filesystem
   - No permission issues with worktrees

3. **Performance**
   - Container pooling for instant execution
   - No worktree creation overhead
   - Parallel execution support

4. **Safety**
   - All changes isolated in container
   - Comprehensive diff review
   - Atomic application of changes

## Configuration

### Environment Variables

- `MCP_CLAUDE_DEBUG=true` - Enable debug logging
- `DOCKER_HOST` - Custom Docker socket path
- `CLAUDE_PARALLEL_STREAM_PORT` - Streaming server port (default: 45320)

### Container Configuration

```javascript
{
  memory: '2g',      // Memory limit
  cpus: '2',         // CPU limit
  timeout: 1800000,  // 30 minutes
  networkIsolation: false  // Network access allowed
}
```

## Security Features

### Automatic Review Required For:

- Changes to sensitive files (`.env`, `*secret*`, `*auth*`)
- Large changes (>10 files or >500 lines)
- File deletions
- Binary file modifications

### Container Isolation

- Containers run as non-root user
- Limited capabilities
- Firewall rules for network access
- Automatic cleanup after execution

## Testing

### Integration Tests

```bash
npm run test:integration
```

Tests complete flow from task creation to diff application.

### Git-Specific Tests

```bash
npm run test:git
```

Tests Git initialization, diff extraction, and patch application.

## Migration from Old Approach

Since this is early development, no migration is needed. The old worktree-based code has been removed completely.

## File Structure

```
src/
├── tools/
│   ├── git-container-diff-manager.ts  # Git operations in containers
│   ├── git-diff-integration.ts        # High-level diff management
│   └── claude-code-git-integrated.ts  # Main execution manager
├── docker/
│   ├── containerManager.ts            # Container lifecycle
│   └── containerLifecycleManager.ts   # Container monitoring
├── types/
│   └── git-diff-types.ts              # TypeScript interfaces
└── server.ts  # MCP server implementation
```

## Future Improvements

1. **Diff Caching**
   - Store diffs in persistent storage
   - Enable diff history and rollback

2. **Incremental Diffs**
   - Support multiple execution rounds
   - Show cumulative changes

3. **Conflict Resolution**
   - Handle merge conflicts automatically
   - Three-way merge support

4. **Performance Optimization**
   - Pre-warmed containers with common dependencies
   - Diff compression for large changes

## Conclusion

The Git-integrated approach provides a robust, simple solution for tracking changes made by Claude Code inside Docker containers. By leveraging Git's capabilities inside the container, we achieve reliable diff extraction without the complexity of worktrees.