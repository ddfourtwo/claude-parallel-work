# Known Issues and Status

## ✅ Resolved Issues

### 1. MCP Protocol Contamination (CRITICAL - FIXED)
**Issue**: Server crashed with JSON parsing error from Winston logger ANSI colors.
**Fix**: Detect MCP mode and disable console output; replaced `console.log/error` with proper logging.
**Status**: ✅ Resolved - Server now starts successfully

### 2. Log Directory Mismatch (FIXED)
**Issue**: Logs created in `dist/logs/` but documentation pointed to `src/logs/`.
**Fix**: Updated documentation and user messages to reference correct location.
**Status**: ✅ Resolved

### 3. User Normalization (FIXED)
**Issue**: Inconsistent user names between Dockerfile and execution.
**Fix**: Standardized on "node" user throughout system.
**Status**: ✅ Resolved

### 4. Missing Monitoring Tools (FIXED)
**Issue**: Users couldn't monitor running tasks.
**Fix**: Added comprehensive monitoring via `work_status`, `view_container_logs`, and tmux integration.
**Status**: ✅ Resolved

## ⚠️ Active Issues

### 1. Claude API Timeout
**Issue**: Tasks timeout after 5 minutes with "API Error: Request timed out".
**Impact**: Task breakdowns fail silently; git diff shows "No changes".
**Investigation Needed**: 
- Increase timeout for Claude CLI commands
- Break down prompts into smaller chunks
- Add retry logic for timeouts

### 2. Misleading Success Status on Timeout
**Issue**: Tasks marked as "Success: true" even when they timeout.
**Impact**: Users think tasks succeeded when they failed.
**Fix Needed**: Properly detect timeout errors and mark as failed.

### 3. Tmux Output Capture
**Issue**: Current tmux implementation may not capture all output properly.
**Impact**: Logs may be incomplete during tmux sessions.
**Investigation Needed**: Refine output capture mechanism.

## 🔧 Improvements Needed

### 1. Container Cleanup
- Ensure containers are properly cleaned up after sessions end
- Monitor tmux session status for cleanup triggers

### 2. Error Handling
- Add automated tests for timeout scenarios
- Improve error messages when timeouts occur
- Add progress indicators for long-running tasks

### 3. Performance
- Test with various task sizes to find optimal timeout values
- Add performance monitoring for task execution

## 📋 Testing Checklist

When making changes, verify:
- [ ] Server starts without MCP protocol errors
- [ ] Logs are created in correct location (`dist/logs/`)
- [ ] `work_status` and `view_container_logs` work correctly
- [ ] Task timeouts are properly detected and reported
- [ ] Git diff extraction works after task completion
- [ ] Container cleanup happens after task completion