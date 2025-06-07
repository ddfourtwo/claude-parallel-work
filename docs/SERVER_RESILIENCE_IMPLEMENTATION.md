# Server Resilience Implementation

## Overview

We have successfully implemented comprehensive server resilience features to address the critical issue of losing all in-memory state when the MCP server crashes or restarts.

## Implemented Features

### 1. Winston Logging Framework

**Location**: `src/utils/logger.ts`

- Comprehensive server logging with automatic log rotation
- Separate error and combined log files
- Process error handlers for uncaught exceptions
- Tool invocation tracking with timing and error details
- Structured logging with metadata support

**Log Files**:
- `logs/server-error.log` - Error logs only
- `logs/server-combined.log` - All server logs
- Auto-rotates at 10MB, keeps last 5 files

### 2. SQLite Persistence Layer

**Location**: `src/persistence/database.ts`

**Database Schema**:
- `background_tasks` - Tracks all background task executions
- `git_diffs` - Stores git diffs for review/apply workflow
- `containers` - Registry of Docker containers
- `execution_logs` - References to execution log files

**Features**:
- WAL mode for better concurrent access
- Indexed queries for performance
- Automatic cleanup of old data
- JSON serialization for complex objects

### 3. Startup Recovery Manager

**Location**: `src/recovery/startup-recovery.ts`

**Recovery Actions**:
1. **Container Recovery**:
   - Finds orphaned containers with `claude-parallel=true` label
   - Adopts running containers back into the system
   - Cleans up old stopped containers (>1 hour)

2. **Task Recovery**:
   - Identifies interrupted tasks (status: running/started)
   - Marks tasks as failed if container no longer exists
   - Preserves tasks with active containers

3. **Data Cleanup**:
   - Removes data older than 7 days
   - Rejects diffs for non-existent containers

### 4. Integration Points

**Server Initialization** (`src/server.ts`):
- Creates PersistenceManager instance
- Runs startup recovery before initializing tools
- Graceful shutdown closes persistence connection

**GitIntegratedClaudeCodeManager** (`src/tools/claude-code-git-integrated.ts`):
- Saves background tasks to persistence
- Retrieves tasks from database if not in memory
- Persists task state changes

**GitDiffIntegration** (`src/tools/git-diff-integration.ts`):
- Saves git diffs to persistence when created
- Retrieves diffs from database if not in memory
- Updates diff status when applied/rejected

## Usage

### Starting the Server

The server automatically:
1. Initializes the persistence layer
2. Runs startup recovery
3. Logs all operations to files

### Monitoring

**Server Logs**:
```bash
# View recent errors
tail -f logs/server-error.log

# View all server activity
tail -f logs/server-combined.log

# Search logs
grep "Tool invoked" logs/server-combined.log
```

**Database Inspection**:
```bash
# Open SQLite database
sqlite3 data/claude-parallel.db

# View recent tasks
SELECT id, status, start_time FROM background_tasks ORDER BY start_time DESC LIMIT 10;

# View pending diffs
SELECT id, files_changed, created_at FROM git_diffs WHERE status = 'pending';
```

### Recovery Scenarios

1. **Server Crash During Task Execution**:
   - On restart, task is found in "running" state
   - If container exists: Task can potentially be monitored
   - If container missing: Task marked as failed

2. **Server Crash with Pending Diffs**:
   - Diffs are preserved in database
   - Can be reviewed and applied after restart
   - Associated container info maintained

3. **Long Server Downtime**:
   - Old data automatically cleaned up
   - Orphaned resources removed
   - System returns to clean state

## Benefits

1. **No Data Loss**: All critical state persisted to disk
2. **Automatic Recovery**: Server self-heals on restart
3. **Audit Trail**: Complete logs of all operations
4. **Debugging**: Detailed logs for troubleshooting
5. **Performance**: Indexed database queries, log rotation

## Configuration

**Environment Variables**:
- `LOG_LEVEL` - Set logging level (default: info)
- `CLAUDE_PARALLEL_DB_PATH` - Custom database location

**Maintenance**:
- Logs auto-rotate at 10MB
- Old data cleaned up after 7 days
- Manual cleanup: `rm -rf logs/* data/*`

## Future Enhancements

1. **Metrics Dashboard**: Visualize task success rates
2. **Log Aggregation**: Send logs to external service
3. **Backup/Restore**: Database backup functionality
4. **Task Resume**: Attempt to reconnect to running containers