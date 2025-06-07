# Comprehensive Task Planning Session
Please create a comprehensive task plan for: $ARGUMENTS

**This is your only job for this session.** Focus entirely on creating the most thorough, well-informed task plan possible.

## Process:
1. **Context Gathering**: Read as many relevant docs and project files into context as possible:
   - README files, documentation, specs
   - Package.json, requirements.txt, or similar dependency files
   - Existing code structure and architecture files
   - Any relevant configuration files
   - Previous task plans or project notes

2. **Ultra-thinking Phase**: Deeply analyze the request in the context of:
   - Current project architecture and constraints
   - Existing patterns and conventions in the codebase
   - Dependencies and potential conflicts
   - Best practices for the technology stack
   - Risk factors and complexity considerations
   - Ultrathink about it

3. **Task Generation**: Create the comprehensive task plan based on your analysis

Task Request: $ARGUMENTS

## Requirements:
1. Break this down into concrete, actionable tasks as needed
2. Identify dependencies between tasks
3. Prioritize making tasks that can run in parallel when possible
4. Maximize parallel execution opportunities while maintaining logical dependencies

## Output Format:
Create a file called "tasks.json" in the current directory with this structure:

```json
{
  "meta": {
    "projectName": "Project name",
    "createdAt": "ISO timestamp",
    "lastModified": "ISO timestamp"
  },
  "tasks": [
    {
      "id": "proj-feature-1",
      "title": "Brief title",
      "description": "One-line description",
      "status": "pending",
      "dependencies": [],
      "priority": "high",
      "details": "Detailed implementation instructions for the developer",
      "testStrategy": "How to verify this task is complete",
      "subtasks": [
        {
          "id": "proj-validation-1",
          "title": "Subtask title",
          "description": "Subtask description",
          "status": "pending",
          "dependencies": ["proj-validation-2"],
          "priority": "medium"
        }
      ]
    }
  ]
}
```

## Guidelines:
- Generate unique task IDs using the format: "project-feature-number"
  - Project: 3-4 letter abbreviation from project name (e.g., "cpw" for "Claude Parallel Work")
  - Feature: Short feature/module name (e.g., "auth", "ui", "db", "api")
  - Number: Sequential number within that feature area (1, 2, 3...)
  - Examples: "cpw-auth-1", "app-ui-3", "cms-api-2"
- For subtasks, use the same format: "project-subfeature-number" (e.g., "cpw-validation-1", "cpw-error-2")
- Use clear, specific titles
- Details should be comprehensive implementation instructions
- Test strategies should be concrete and verifiable
- Set appropriate dependencies (array of task IDs, e.g., ["cpw-db-1", "cpw-auth-2"])
- Priority: "high" for critical path, "medium" for normal, "low" for nice-to-have
- Use subtasks when a task has distinct sub-components that can be tracked separately
- Subtasks are referenced as "parentId.subtaskId" (e.g., "cpw-auth-1.cpw-validation-1")
- Subtask dependencies reference other subtasks within the same parent task

Create the tasks.json file now.

## Validation:
After creating the tasks.json file, use the validate_tasks tool to ensure the format is valid for the claude-parallel-work mcp server:

```
validate_tasks workFolder="/project"
```

If validation fails, fix any format issues and re-validate until the file passes all checks.