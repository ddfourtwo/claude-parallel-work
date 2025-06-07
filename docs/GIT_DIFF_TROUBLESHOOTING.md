# Git Diff Troubleshooting Guide

## Issue Overview
When Claude modifies files in containers, git diff extraction sometimes reports "No changes" despite files being successfully modified. This guide documents the root causes and solutions.

## Root Causes & Fixes

### 1. Git Diff Command Issues (FIXED)
**Problem**: Git diff commands without HEAD reference weren't detecting changes properly.

**Solution Applied**:
- Added `HEAD` to all git diff commands
- Fixed exit code detection in `execInContainer` method
- Commands now properly check `git diff --cached --quiet HEAD` exit codes

### 2. File Ownership Problems
**Problem**: Modified files owned by `root:root` instead of `node:node`.

**Diagnostic Steps**:
```bash
# Check file ownership
docker exec <container> ls -la /workspace/

# Check git status
docker exec <container> bash -c "cd /workspace && git status"

# Check if file is tracked
docker exec <container> bash -c "cd /workspace && git ls-files | grep filename"
```

**Solution**: Ensure proper user context during file operations.

### 3. Working Directory Issues
**Problem**: Claude operations outside the tracked `/workspace` directory.

**Evidence**: Files created in `/tmp/` instead of `/workspace/` won't be tracked by git.

**Solution**: Verify all operations happen within the git-tracked workspace.

## Debugging Tools

### 1. Container Debug Mode
Enable container persistence for debugging:
```bash
# Enable debug mode (prevents cleanup)
export CLAUDE_PARALLEL_DEBUG_NO_CLEANUP=true

# Or use the debug helper
./debug-mode.sh enable
```

### 2. Manual Container Inspection
```bash
# Find running container
docker ps --filter "name=claude-parallel"

# Inspect git state
docker exec <container> bash -c "cd /workspace && git status"
docker exec <container> bash -c "cd /workspace && git diff --cached HEAD"
docker exec <container> bash -c "cd /workspace && git log --oneline"

# Check file permissions
docker exec <container> ls -la /workspace/

# Test git diff exit codes
docker exec <container> bash -c 'cd /workspace && if git diff --cached --quiet HEAD; then echo "no changes"; else echo "has changes"; fi'
```

### 3. Log Analysis
Check container logs for git operations:
```bash
# View container logs
parallel-work logs --containers

# Or view specific task logs
view_container_logs identifier="task-123"
```

## Common Scenarios

### Scenario 1: File Modified but No Diff
**Symptoms**: Claude reports file modification, but diff shows "No changes"
**Investigation**:
1. Check file ownership: `ls -la /workspace/`
2. Verify git tracking: `git ls-files | grep filename`
3. Check working directory: Ensure operations in `/workspace/`

### Scenario 2: Git Status Clean After Changes
**Symptoms**: `git status` shows "nothing to commit" after modifications
**Investigation**:
1. Check if changes were committed: `git log --oneline`
2. Verify staging area: `git diff --cached HEAD`
3. Check for timing issues in git operations

### Scenario 3: Files Created Outside Workspace
**Symptoms**: Files exist but aren't tracked by git
**Investigation**:
1. Check file location: `find /container -name "filename"`
2. Verify workspace mount: `ls -la /workspace/`
3. Review Claude execution context

## Testing Commands

### Quick Git Diff Test
```bash
# Create test file and stage it
docker exec <container> bash -c "cd /workspace && echo 'test' > test.txt && git add test.txt"

# Check if diff detects it
docker exec <container> bash -c "cd /workspace && git diff --cached --quiet HEAD"
echo "Exit code: $?"  # Should be 1 if changes exist

# Show the diff
docker exec <container> bash -c "cd /workspace && git diff --cached HEAD"
```

## Fixed Issues History

### Git Command Fixes (src/tools/git-container-diff-manager.ts)
- ✅ Added HEAD reference to all git diff commands
- ✅ Fixed exit code detection in execInContainer method
- ✅ Proper error handling for git operations

### Container Integration Fixes (src/tools/claude-code-git-integrated.ts)
- ✅ Added debug mode for container persistence
- ✅ Improved error logging for git operations
- ✅ Better workspace initialization

## Prevention Tips

1. **Always verify workspace context**: Ensure Claude operations happen in `/workspace/`
2. **Check file permissions**: Maintain consistent user ownership
3. **Use debug mode**: When troubleshooting, enable container persistence
4. **Monitor logs**: Check container logs for git operation details
5. **Test incrementally**: Use simple test cases to verify git diff functionality

## Related Files

- `src/tools/git-container-diff-manager.ts` - Core git diff logic
- `src/tools/claude-code-git-integrated.ts` - Container integration
- `src/tools/git-diff-integration.ts` - Git diff extraction
- `docs/KNOWN_ISSUES.md` - Active issues and status