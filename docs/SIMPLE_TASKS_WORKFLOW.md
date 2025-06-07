# Simple Tasks Workflow for claude-parallel-work

This document explains how agents use the simplified tasks.json system.

## Overview

The tasks.json file is a simple, agent-friendly task list that:
- Tracks what needs to be done
- Shows dependencies between tasks
- Provides implementation details (prompts)
- Records which container is working on each task

## Agent Workflow

### 1. Check Task Status

```
Agent uses: work_status
↓
Response: {
  "summary": {
    "total": 10,
    "done": 3,
    "inProgress": 1,
    "ready": 2,
    "blocked": 4
  },
  "nextTask": {
    "id": 4,
    "title": "Add Database Layer",
    "priority": "high"
  }
}
```

### 2. Execute Next Task

```
Agent reads task details from tasks.json
↓
Agent uses: code_worker with task.details as prompt
↓
Response: { 
  taskId: "task-abc123", 
  containerId: "claude-xyz789",
  diffId: "diff-def456"  // Contains the code changes
}
```

### 3. Review and Apply Changes

```
Agent uses: review_changes
  - diffId: "diff-def456"
↓
Shows: Files changed, additions/deletions, risk assessment
↓
Agent decides: Changes look good
↓
Agent uses: apply_changes
  - diffId: "diff-def456"
  - targetWorkspace: "/path/to/project"
```

### 4. Update Task Status

```
After changes are applied successfully:
↓
Agent uses: update_task_status
  - taskId: 4
  - status: "done"
  - containerId: "claude-xyz789"
```

### 5. Handle Task Failures

```
If review shows problems:
↓
Agent uses: reject_changes
  - diffId: "diff-def456"
  - reason: "Tests are failing"
↓
Agent uses: update_task_status
  - taskId: 4
  - status: "failed"
  - error: "Tests failing - needs retry"
```

## Key Differences from Complex Version

### What We Removed:
- ❌ Parallel execution groups
- ❌ Execution time tracking
- ❌ File conflict analysis
- ❌ Complex risk assessment
- ❌ Performance metrics
- ❌ In-memory storage

### What We Kept:
- ✅ Simple task list
- ✅ Dependencies
- ✅ Priority levels
- ✅ Implementation details (prompts)
- ✅ Container ID tracking
- ✅ Basic status (pending/in-progress/done/failed)

## Example Agent Conversation

```
Human: Create a plan for building an authentication system

Agent: I'll break down this project into tasks.

Created tasks.json with 8 tasks. Here's the summary:
- Task 1: Initialize repository (ready to start)
- Task 2: Set up database (depends on 1)
- Task 3: Create user model (depends on 2)
- Task 4: Implement auth service (depends on 3)
- Task 5: Add JWT middleware (depends on 4)
- Task 6: Create auth endpoints (depends on 5)
- Task 7: Add tests (depends on 6)
- Task 8: Documentation (depends on 7)
```

## Parallel Execution Example

Sometimes dependencies allow multiple tasks to run in parallel:

```
Human: Build a web application with frontend and backend

Agent: I'll analyze the tasks for parallel execution opportunities.

Created tasks.json with 12 tasks. Dependency analysis shows:

Ready now (can run in parallel):
- Task 1: Initialize repository ✅

After Task 1 completes, these can run IN PARALLEL:
- Task 2: Set up backend structure (depends on 1)
- Task 3: Set up frontend structure (depends on 1) 
- Task 4: Configure build tools (depends on 1)

After Tasks 2 & 3 complete, these can run IN PARALLEL:
- Task 5: Create database models (depends on 2)
- Task 6: Implement API routes (depends on 2)
- Task 7: Create React components (depends on 3)
- Task 8: Set up Redux store (depends on 3)
```

### How the Agent Handles Parallel Tasks

```
Human: Please work on the available tasks

Agent: Let me check what tasks are ready to execute.

*Uses work_status*

I see 3 tasks are ready to run in parallel:
- Task 2: Set up backend structure
- Task 3: Set up frontend structure  
- Task 4: Configure build tools

I'll start all three in parallel using separate code_worker instances:

*Starts Task 2*
code_worker: Setting up backend structure...
Response: { taskId: "task-abc123", containerId: "backend-container-001" }

*Starts Task 3*
code_worker: Setting up frontend structure...
Response: { taskId: "task-def456", containerId: "frontend-container-002" }

*Starts Task 4*
code_worker: Configuring build tools...
Response: { taskId: "task-ghi789", containerId: "build-container-003" }

All three tasks are now running in parallel in separate containers!

*Updates task statuses to in-progress*
- Task 2: status = "in-progress", containerId = "backend-container-001"
- Task 3: status = "in-progress", containerId = "frontend-container-002"
- Task 4: status = "in-progress", containerId = "build-container-003"

*Later, Task 4 completes first*
Response from code_worker: { diffId: "diff-build-123" }

*Reviews changes for Task 4*
review_changes: Shows webpack config, package.json updates, build scripts
Agent: The build configuration looks correct. Applying changes.

*Applies changes*
apply_changes: { diffId: "diff-build-123", targetWorkspace: "/project" }
Response: Changes applied successfully

*Updates Task 4 status*
update_task_status: { taskId: 4, status: "done" }
```

### Monitoring Parallel Execution

```
Human: What's the status of the tasks?

Agent: Let me check the current task status.

*Uses work_status*

Current status:
- Task 1: ✅ Done (Initialize repository)
- Task 2: 🔄 In Progress (Set up backend) - Container: backend-container-001
- Task 3: 🔄 In Progress (Set up frontend) - Container: frontend-container-002
- Task 4: ✅ Done (Configure build tools)
- Task 5-8: ⏸️ Blocked (waiting for dependencies)

I can see Task 4 has completed! Once Task 2 finishes, we'll be able to start:
- Task 5: Create database models
- Task 6: Implement API routes

And once Task 3 finishes, we can start:
- Task 7: Create React components  
- Task 8: Set up Redux store

The parallel execution is saving time - instead of running 1-2-3-4 sequentially,
we ran 2, 3, and 4 at the same time!
```

### Visual Dependency Graph

```
Task 1: Initialize repo
   ├── Task 2: Backend setup ──┬── Task 5: Database models
   │                           └── Task 6: API routes
   ├── Task 3: Frontend setup ─┬── Task 7: React components
   │                           └── Task 8: Redux store
   └── Task 4: Build tools

Parallel opportunities:
- Level 1: Task 1 (must run first)
- Level 2: Tasks 2, 3, 4 (can run in parallel)
- Level 3: Tasks 5+6 parallel with 7+8 (two parallel groups)
```

### Key Points About Parallel Execution

1. **Dependencies Define Parallelism**: Tasks with the same dependencies can run in parallel
2. **Container Isolation**: Each code_worker runs in its own container (no conflicts)
3. **Agent Orchestrates**: The agent decides when to launch parallel tasks
4. **Simple Tracking**: containerId field shows which container handles each task
5. **No Special Config**: The same simple tasks.json enables parallel execution naturally

## Complete Agent Workflow with Diff Management

The full workflow for each task:

```
1. Check available tasks (work_status)
   ↓
2. Start task with code_worker
   ↓
3. Receive diffId when complete
   ↓
4. Review changes (review_changes)
   ↓
5. Apply or reject (apply_changes/reject_changes)
   ↓
6. Update task status (update_task_status)
```

This ensures:
- **Code Review**: Agent reviews all changes before applying
- **Safety**: Bad changes can be rejected
- **Tracking**: diffId links tasks to their code changes
- **Flexibility**: Agent can retry failed tasks with modifications