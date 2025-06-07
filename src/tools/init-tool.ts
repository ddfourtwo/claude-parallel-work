import * as fs from 'fs/promises';
import * as path from 'path';

export interface InitProjectArgs {
  workFolder: string;
  force?: boolean;
}

export class InitTool {
  private static readonly ORCHESTRATION_CONTENT = `<parallel-work-orchestration>
# Claude Parallel Work Orchestration Guide

You have access to the Claude Parallel Work MCP server, which enables you to execute development tasks up to MUCH faster through intelligent parallelization.

## Core Orchestration Principles

### When to Use Parallel Work
- **Multi-file refactoring**: Changes that affect multiple files can be done in parallel
- **Feature implementation**: Break down features into independent subtasks
- **Large-scale updates**: Dependency updates, API changes, code migrations
- **Test writing**: Tests for different modules can be written simultaneously

### When to Work Synchronously (Yourself)
- **Single file edits**: Quick fixes or small changes
- **Sequential dependencies**: Tasks that must be done in order
- **Investigation/debugging**: When you need to understand the codebase
- **User interaction**: When you need to ask questions or get clarification

## Optimal Workflow

1. **Analyze the request** - Determine if the task can benefit from parallelization
2. **If a tasks.json exists in root**:
   - Validate the generated tasks.json
   - Execute with \`get_next_tasks\` → \`task_worker\` (multiple in parallel)
   - Monitor progress with \`work_status\`
3. **If no tasks.json but the request would clearly benefit from parallelization**:
   - Create a tasks.json with the necessary tasks
   - Execute with \`get_next_tasks\` → \`task_worker\` (multiple in parallel)
   - Monitor progress with \`work_status\`
3. **For simple tasks**: Execute directly using your standard tools

## Key Commands
- \`task_worker\` - Execute individual tasks in isolated containers
- \`get_next_tasks\` - Find all tasks ready for parallel execution
- \`work_status\` - Monitor background execution
- \`review_changes\` - Preview all modifications
- \`apply_changes\` - Merge approved changes

Remember: The goal is to maximize efficiency by running independent tasks in parallel while maintaining code quality and safety through the review process.

# Task Generation

## Requirements:
1. Break this down into concrete, actionable tasks as needed
2. Identify dependencies between tasks
3. Prioritize making tasks that can run in parallel when possible
4. Maximize parallel execution opportunities while maintaining logical dependencies

## Output Format:
Create a file called "tasks.json" in the current directory with this structure:

\`\`\`json
{
  "meta": {
    "projectName": "Project name",
    "createdAt": "ISO timestamp",
    "lastModified": "ISO timestamp"
  },
  "tasks": [
    {
      "id": 1,
      "title": "Brief title",
      "description": "One-line description",
      "status": "pending",
      "dependencies": [],
      "priority": "high",
      "details": "Detailed implementation instructions for the developer",
      "testStrategy": "How to verify this task is complete",
      "subtasks": [
        {
          "id": 1,
          "title": "Subtask title",
          "description": "Subtask description",
          "status": "pending",
          "dependencies": [2],
          "priority": "medium"
        }
      ]
    }
  ]
}
\`\`\`

## Guidelines:
- Number tasks sequentially starting from 1
- Use clear, specific titles that reference planning/requirements document
- Details should be comprehensive implementation instructions
- Test strategies should be concrete and verifiable
- Set appropriate dependencies (array of task IDs)
- Priority: "high" for critical path, "medium" for normal, "low" for nice-to-have
- Use subtasks when a task has distinct sub-components that can be tracked separately
- Subtasks are referenced as "parentId.subtaskId" (e.g., "1.2" for subtask 2 of task 1)
- Subtask dependencies reference other subtasks within the same parent task

Create the tasks.json file now.

## Validation:
After creating the tasks.json file, use the validate_tasks tool to ensure the format is valid for the claude-parallel-work mcp server:

\`\`\`
validate_tasks tasks.json
\`\`\`

If validation fails, fix any format issues and re-validate until the file passes all checks.
</parallel-work-orchestration>`;

  static async initializeProject(args: InitProjectArgs): Promise<string> {
    const { workFolder, force = false } = args;
    
    // Validate workFolder exists
    try {
      await fs.access(workFolder);
    } catch (error) {
      throw new Error(`Work folder does not exist: ${workFolder}`);
    }

    const claudeFile = path.join(workFolder, 'CLAUDE.md');
    
    // Check if CLAUDE.md exists
    const claudeExists = await this.fileExists(claudeFile);
    
    if (claudeExists) {
      // Update existing CLAUDE.md
      const result = await this.updateClaudeMd(claudeFile, force);
      return result;
    } else {
      // Create new CLAUDE.md with orchestration content
      const claudeContent = `# Project Context

${InitTool.ORCHESTRATION_CONTENT}
`;
      await fs.writeFile(claudeFile, claudeContent, 'utf-8');
      return "Created CLAUDE.md with parallel work orchestration guide";
    }
  }

  private static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private static async updateClaudeMd(claudeFile: string, force: boolean): Promise<string> {
    const content = await fs.readFile(claudeFile, 'utf-8');
    
    // Check if orchestration content already exists
    if (content.includes('<parallel-work-orchestration>')) {
      if (!force) {
        return "CLAUDE.md already contains parallel work orchestration. Use force=true to update.";
      }
      // Replace existing orchestration content
      const updatedContent = content.replace(
        /<parallel-work-orchestration>[\s\S]*?<\/parallel-work-orchestration>/g,
        InitTool.ORCHESTRATION_CONTENT
      );
      await fs.writeFile(claudeFile, updatedContent, 'utf-8');
      return "Updated parallel work orchestration in CLAUDE.md";
    } else {
      // Append orchestration content
      const updatedContent = content.trimEnd() + '\n\n' + InitTool.ORCHESTRATION_CONTENT + '\n';
      await fs.writeFile(claudeFile, updatedContent, 'utf-8');
      return "Added parallel work orchestration to CLAUDE.md";
    }
  }
}