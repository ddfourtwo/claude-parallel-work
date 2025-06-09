# Installing Claude Code Slash Commands

If slash commands are not properly installed during the main installation, use the standalone installer:

## Quick Install

```bash
./install-slash-commands.sh
```

## What it does

The script installs three powerful slash commands for Claude Code:

1. **`/break-down-to-work-plan`** - AI-powered task breakdown
   - Analyzes requirements and creates parallel task plans
   - Identifies dependencies and optimal execution order
   - Generates testable, atomic tasks

2. **`/orchestrate-tasks`** - Task orchestration and management
   - Manages complex multi-step workflows
   - Coordinates parallel execution
   - Tracks dependencies and progress

3. **`/work-plan-from-doc`** - Document to task converter
   - Converts PRDs, specs, and documentation into tasks
   - Extracts actionable items from technical documents
   - Creates structured work plans from prose

## Manual Installation

If the script doesn't work, you can manually copy the commands:

```bash
mkdir -p ~/.claude/commands
cp commands/*.md ~/.claude/commands/
```

## Verifying Installation

Check that the commands are installed:

```bash
ls ~/.claude/commands/
```

You should see:
- break-down-to-work-plan.md
- orchestrate-tasks.md
- work-plan-from-doc.md

## Using the Commands

In Claude Code, type `/` followed by the command name. For example:
- `/break-down-to-work-plan Create a React todo app with user authentication`
- `/orchestrate-tasks`
- `/work-plan-from-doc`

The commands will help you create optimized parallel task plans that work seamlessly with the Claude Parallel Work MCP server.