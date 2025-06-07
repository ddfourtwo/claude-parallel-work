# Interactive Claude Container Sessions Plan

## Overview
Enable back-and-forth conversations with Claude in containers, allowing the controlling agent to provide clarifications when Claude asks questions instead of treating them as failures.

## Implementation Plan

### 1. Modify Execution Result Types
Add a new status `needs_input` to indicate Claude is waiting for clarification:
- Update `GitIntegratedExecutionResult` interface to include:
  - `status?: 'completed' | 'needs_input' | 'failed'`
  - `pendingQuestion?: string` field to capture Claude's question
  - `sessionId?: string` to track the conversation session
- Keep the container running when Claude asks a question

### 2. Change Question Detection Logic
Instead of treating questions as failures:
- Return `success: true` with `status: 'needs_input'`
- Store the question in the result
- Keep the container alive for follow-up
- Detection criteria:
  - Output contains "?" 
  - No code blocks (```) 
  - Output length < 500 characters
  - No file operations detected

### 3. Create New Tool: `answer_worker_question`
This tool will:
- Accept parameters:
  - `taskId`: The original task ID
  - `answer`: The answer to Claude's question
- Find the running container associated with the task
- Execute a new Claude command with the answer as context
- Continue the conversation flow
- Return the updated status/result

### 4. Container State Management
Track containers with pending questions:
- Add a `containerSessions` Map to track active sessions
- Store:
  - Container ID
  - Task ID
  - Conversation state
  - Last question asked
  - Session start time
- Clean up sessions when tasks complete or timeout

### 5. Update `work_status` Tool
Show when Claude is waiting for input:
- Display the pending question
- Show instructions on how to use `answer_worker_question`
- Indicate the container is still running
- Show session duration

### 6. Update Container Logs
- Create new log entries for each interaction
- Maintain conversation history in logs
- Track question/answer pairs

## Workflow Example

```bash
# 1. User starts a task
task_worker("Create a REST API for user management")

# 2. Claude asks for clarification
Status: needs_input
Question: "What kind of authentication would you like for the REST API? JWT, OAuth2, or Basic Auth?"

# 3. User provides answer
answer_worker_question(taskId: "task-123", answer: "Use JWT authentication with refresh tokens")

# 4. Claude continues execution
Status: running
Progress: "Creating user management API with JWT authentication..."

# 5. Task completes
Status: completed
Diff ID: diff-456
Files changed: 5
```

## Technical Implementation Details

### Container Lifecycle
1. Container starts with initial task
2. If Claude asks a question:
   - Container remains running
   - Session is tracked
   - Status changes to `needs_input`
3. When answer provided:
   - New Claude command executed in same container
   - Conversation context maintained
   - Execution continues
4. On completion or timeout:
   - Container stopped
   - Session cleaned up
   - Final diff extracted

### Session Timeout
- Sessions timeout after 10 minutes of inactivity
- Timeout is reset on each interaction
- Cleanup job runs periodically to remove stale sessions

### Error Handling
- If container dies unexpectedly, session is marked as failed
- If answer command fails, appropriate error returned
- Network/Docker errors handled gracefully

## Benefits
1. More natural interaction with Claude
2. Better handling of ambiguous requests
3. Ability to refine requirements iteratively
4. Maintains context throughout conversation
5. More efficient than restarting tasks

## Future Enhancements
- Multi-turn conversation history
- Session persistence across server restarts
- Conversation templates for common workflows
- Integration with dashboard for visual Q&A