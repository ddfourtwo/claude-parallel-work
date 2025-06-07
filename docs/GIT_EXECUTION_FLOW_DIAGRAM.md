# Git-Integrated Claude Code Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          GIT-INTEGRATED CLAUDE CODE EXECUTION FLOW                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│   HOST SYSTEM       │
│                     │
│  ┌───────────────┐  │
│  │  Workspace    │  │ ──────────────────────────────────────────────────────┐
│  │  (Git Repo)   │  │                                                        │
│  │               │  │                                                        ▼
│  │  - src/       │  │                                              ┌──────────────────┐
│  │  - tests/     │  │                                              │ 1. CONTAINER     │
│  │  - .git/      │  │                                              │    CREATION      │
│  └───────────────┘  │                                              └────────┬─────────┘
│                     │                                                        │
│  ┌───────────────┐  │                                                        ▼
│  │ Claude Code   │  │                                            ┌─────────────────────┐
│  │   Server      │  │                                            │  Docker Container   │
│  └───────────────┘  │                                            │                     │
└─────────────────────┘                                            │ ┌─────────────────┐ │
                                                                   │ │ /workspace      │ │
                                                                   │ │ (mounted R/W)   │ │
                                                                   │ └─────────────────┘ │
                                                                   │                     │
                                                                   │ ┌─────────────────┐ │
                                                                   │ │ 2. GIT INIT     │ │
                                                                   │ │                 │ │
                                                                   │ │ git config      │ │
                                                                   │ │ git add -A      │ │
                                                                   │ │ git commit      │ │
                                                                   │ │ "Initial state" │ │
                                                                   │ └────────┬────────┘ │
                                                                   │          │          │
                                                                   │          ▼          │
                                                                   │ ┌─────────────────┐ │
                                                                   │ │ 3. CLAUDE CODE  │ │
                                                                   │ │    EXECUTION    │ │
                                                                   │ │                 │ │
                                                                   │ │ - Read files    │ │
                                                                   │ │ - Edit files    │ │
                                                                   │ │ - Create files  │ │
                                                                   │ │ - Run commands  │ │
                                                                   │ └────────┬────────┘ │
                                                                   │          │          │
                                                                   │          ▼          │
                                                                   │ ┌─────────────────┐ │
                                                                   │ │ 4. GIT DIFF     │ │
                                                                   │ │   EXTRACTION    │ │
                                                                   │ │                 │ │
                                                                   │ │ git add -A      │ │
                                                                   │ │ git diff HEAD   │ │
                                                                   │ │ > changes.patch │ │
                                                                   │ └────────┬────────┘ │
                                                                   └──────────┼──────────┘
                                                                              │
                                                                              ▼
                                                                   ┌──────────────────────┐
                                                                   │  5. DIFF REVIEW      │
                                                                   │                      │
                                                                   │  ┌────────────────┐  │
                                                                   │  │ changes.patch  │  │
                                                                   │  │                │  │
                                                                   │  │ + Added lines  │  │
                                                                   │  │ - Removed lines│  │
                                                                   │  │ ~ Modified     │  │
                                                                   │  └────────────────┘  │
                                                                   │                      │
                                                                   │   [Review Changes]   │
                                                                   │                      │
                                                                   │  ┌──────┐  ┌──────┐ │
                                                                   │  │ACCEPT│  │REJECT│ │
                                                                   │  └───┬──┘  └──────┘ │
                                                                   └──────┼──────────────┘
                                                                          │
                                                                          ▼
                                                              ┌───────────────────────┐
                                                              │  6. DIFF APPLICATION  │
                                                              │                       │
                                                              │  git apply --check    │
                                                              │  git apply patch      │
                                                              │                       │
                                                              │  ✓ Changes Applied    │
                                                              └───────────────────────┘

═══════════════════════════════════════════════════════════════════════════════════════════

DETAILED FLOW:

1. CONTAINER CREATION
   ├─ Create isolated Docker container
   ├─ Mount workspace directory (read/write)
   └─ Container has full access to project files

2. GIT INITIALIZATION (Inside Container)
   ├─ Configure git user (claude-container)
   ├─ Stage all files: git add -A
   └─ Create initial commit to capture starting state

3. CLAUDE CODE EXECUTION
   ├─ Execute user's requested tasks
   ├─ Modify files as needed
   ├─ Create new files if required
   └─ Run tests or other commands

4. GIT DIFF EXTRACTION
   ├─ Stage all changes: git add -A
   ├─ Generate unified diff: git diff HEAD
   ├─ Capture all modifications since initial commit
   └─ Export diff as patch file

5. DIFF REVIEW (Host System)
   ├─ Present changes to user
   ├─ Show added/removed/modified lines
   ├─ Allow line-by-line inspection
   └─ User decides: Accept or Reject

6. DIFF APPLICATION (If Accepted)
   ├─ Validate patch: git apply --check
   ├─ Apply changes: git apply patch
   ├─ Changes merged into host workspace
   └─ Container can be safely removed

═══════════════════════════════════════════════════════════════════════════════════════════

KEY BENEFITS:
• Isolation: Changes happen in container, not directly on host
• Safety: Review all changes before applying
• Tracking: Git provides complete audit trail
• Reversibility: Can reject changes if needed
• Atomicity: All changes applied together or not at all
```