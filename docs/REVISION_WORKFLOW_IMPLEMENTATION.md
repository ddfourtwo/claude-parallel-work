# Revision Workflow Implementation Plan

## Overview
Enhance the change rejection workflow to support iterative revisions instead of discarding all work. This allows agents to request specific changes while preserving container context and previous work.

## Problem Statement
Current `reject_changes` tool:
- Discards all changes and container context
- Loses valuable work and computation
- Forces starting from scratch
- Doesn't match real-world code review workflows

## Solution: Request Revision Tool

### New Tool: `request_revision`
A tool that allows agents to request specific changes to existing work without losing context.

## Implementation Architecture

### 1. Container State Management
- **Preserve container**: Keep container alive or in suspended state
- **Session tracking**: Maintain session ID for Claude CLI continuity
- **State preservation**: Save workspace state for revision

### 2. Revision Request Structure
```typescript
interface RevisionRequest {
  diffId: string;              // Which diff to revise
  feedback: string;            // What needs to be changed
  preserveCorrectParts?: boolean; // Keep working code (default: true)
  additionalContext?: string;  // Extra guidance for revision
}
```

### 3. Workflow States
```
INITIAL_EXECUTION → PENDING_REVIEW → REVISION_REQUESTED → REVISION_IN_PROGRESS → PENDING_REVIEW
                                   ↘                                            ↗
                                     REJECTED (terminal state)
```

### 4. Implementation Steps

#### Phase 1: Container Session Persistence
1. Modify `GitIntegratedClaudeCodeManager` to support session preservation
2. Add container hibernation/resume capabilities
3. Track session IDs with diffs

#### Phase 2: Revision Tool Implementation
1. Create `request_revision` tool in server.ts
2. Add revision handler in `GitIntegratedClaudeCodeManager`
3. Implement revision prompt construction

#### Phase 3: Diff Management Updates
1. Update `GitDiff` type to include revision history
2. Modify diff storage to track revision iterations
3. Add revision count and feedback history

#### Phase 4: Tool Response Updates
1. Update `review_changes` to suggest revision option
2. Modify `reject_changes` to warn about permanent discard
3. Add revision status to `work_status`

## Technical Implementation Details

### 1. Container Session Management
```typescript
interface ContainerSession {
  sessionId: string;
  containerId: string;
  workspaceState: string; // Path to preserved workspace
  lastPrompt: string;
  revisionCount: number;
  status: 'active' | 'hibernated' | 'terminated';
}
```

### 2. Revision Execution Flow
```typescript
async requestRevision(args: RevisionRequest): Promise<RevisionResult> {
  // 1. Retrieve original session
  const session = await this.getSession(args.diffId);
  
  // 2. Construct revision prompt
  const revisionPrompt = this.buildRevisionPrompt(
    session.lastPrompt,
    args.feedback,
    session.workspaceState
  );
  
  // 3. Resume or restart container with state
  const container = await this.resumeContainer(session);
  
  // 4. Execute revision
  const result = await this.executeRevision(
    container,
    revisionPrompt,
    session
  );
  
  // 5. Generate new diff
  return this.createRevisionDiff(result, args.diffId);
}
```

### 3. Revision Prompt Template
```
You previously worked on: [ORIGINAL TASK]

Your implementation has been reviewed with the following feedback:
[FEEDBACK]

Please revise your implementation to address this feedback while preserving the parts that are working correctly.

Current state:
- Files modified: [FILE LIST]
- Changes made: [SUMMARY]

Focus on: [SPECIFIC REVISION REQUIREMENTS]
```

### 4. Tool Descriptions Update
- `review_changes`: Add "request_revision" as next step option
- `request_revision`: Clear triggers and workflow guidance
- `reject_changes`: Clarify this is permanent discard

## Migration Strategy
1. Backward compatible - existing workflows continue to work
2. New revision workflow is opt-in via new tool
3. Gradual adoption through tool descriptions

## Success Metrics
- Reduction in rejected changes that start from scratch
- Faster iteration cycles on complex tasks
- Improved context preservation across revisions
- Agent adoption rate of revision workflow

## Timeline
1. Container session management: 2 hours
2. Revision tool implementation: 2 hours
3. Testing and refinement: 1 hour
4. Documentation updates: 30 minutes

## Risks and Mitigations
- **Risk**: Container state corruption
  - **Mitigation**: Snapshot workspace before revision
- **Risk**: Infinite revision loops
  - **Mitigation**: Max revision count (default: 3)
- **Risk**: Memory/resource usage
  - **Mitigation**: Auto-cleanup after 1 hour idle

## Future Enhancements
1. Partial revision - revise only specific files
2. Revision history visualization
3. Automatic revision suggestions based on common patterns
4. Collaborative revision with multiple agents