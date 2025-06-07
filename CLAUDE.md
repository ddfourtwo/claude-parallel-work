<RULES>
Below you will find a variety of important rules spanning:
- core development philosophy
- test-driven development approach
- claude-parallel-work workflow
- persistent memory management
- project documentation
- claude rules maintenance
- self-improvement processes

---
DEVELOPMENT_PHILOSOPHY
---
description: Core development principles for creating sustainable, AI-friendly code
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **Minimize New Code:**
  - Assess if new functionality is truly necessary before adding
  - New code increases maintenance burden and potential for bugs
  - Thoroughly check for existing code that addresses the need
  - Consider refactoring or extending existing code instead

- **Built for AI Comprehension:**
  - Write clear, readable, self-explanatory code
  - The code itself should be the primary documentation
  - Limit file size and complexity to fit within AI context windows
  - Structure code for easy understanding by both humans and AI

- **Systematic Implementation Process:**
  - Analyze code and dependencies thoroughly before changes
  - Document current state and planned modifications
  - Make single logical changes at a time
  - Implement incremental rollouts with complete integration
  - Perform simulation testing before actual implementation
  - Verify changes with comprehensive test coverage

- **Planning and Documentation:**
  - Always read existing documentation before planning
  - Review architecture documents and task plans
  - Retrieve relevant memories from persistent storage
  - Set up development environment with proper monitoring
  - Update documentation after implementation
  - Capture learnings in persistent memory

- **Testing Requirements:**
  - Write tests for all new functionality
  - Use dependency-based testing to verify existing behavior
  - Verify no breakage of existing functionality
  - Document testing procedures and results
  - Use UI testing procedures for interface changes
  - Always use playwright-mcp for E2E testing

---
TEST_DRIVEN_DEVELOPMENT
---
description: Guidelines for implementing test-driven development practices across all project components
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **TDD Core Workflow:**
  ```mermaid
  flowchart LR
  A[1. Write Test First] --> B[2. Run Test - Verify Failure]
  B --> C[3. Implement Minimal Code]
  C --> D[4. Run Test - Verify Pass]
  D --> E[5. Refactor Code]
  E --> F[6. Run Test - Verify Still Passes]
  F -->|Next Feature| A
  ```

- **Test-First Development:**
  - ALWAYS write tests BEFORE implementing functionality
  - Tests should be derived from task requirements and expected behavior
  - Start by defining the expected outcome and interface of the feature
  - Create failing tests that validate the desired behavior
  - Only after tests are written and failing, implement the actual code
  - The failing test validates that your test is actually testing something
  - This enforces proper design and clear requirements understanding

- **Backend Test Implementation:**
  - Use appropriate testing framework for your language/ecosystem
  - Begin with unit tests for core logic and business rules
  - Add integration tests to validate component interactions
  - Create API tests for endpoint behavior
  - Implement database tests with appropriate setup/teardown
  - Mock external services to isolate functionality
  - Write tests at appropriate granularity (unit, integration, system)
  
- **Frontend/UI Test Implementation:**
  - ALWAYS use playwright-mcp server for E2E testing
  - Start with component unit tests for individual UI elements
  - Add integration tests for component interactions
  - Create E2E tests for complete user flows
  - Test both positive paths and error conditions
  - Validate accessibility requirements
  - Example playwright-mcp test flow:
    ```javascript
    // ✅ DO: Write E2E tests first to define expected user behavior
    test('User can create a new task', async () => {
      // Navigate to task page
      await mcp__playwrite-mcp__browser_navigate({ url: '/tasks' });
      
      // Click new task button
      await mcp__playwrite-mcp__browser_click({
        element: 'New Task button',
        ref: 'some-element-id'
      });
      
      // Fill task form fields
      await mcp__playwrite-mcp__browser_type({
        element: 'Task title field',
        ref: 'title-input',
        text: 'My Test Task'
      });
      
      // Submit form
      await mcp__playwrite-mcp__browser_click({
        element: 'Submit button',
        ref: 'submit-btn'
      });
      
      // Verify task appears in list
      await mcp__playwrite-mcp__browser_wait_for({
        text: 'My Test Task'
      });
    });
    ```

- **Test Granularity:**
  - Write tests at multiple levels of granularity:
    - Unit tests for individual functions/methods
    - Integration tests for component interactions
    - System tests for end-to-end workflows
  - Balance between fine-grained unit tests and broader integration tests
  - Unit tests should validate core business logic with minimal dependencies
  - Integration tests should validate component interfaces and interactions
  - System tests should validate complete workflows and user stories

- **Test-Driven Design Benefits:**
  - Enforces clear understanding of requirements before implementation
  - Results in modular, loosely coupled code
  - Provides confidence when refactoring
  - Creates a safety net for future changes
  - Documents expected behavior through test cases
  - Reduces debugging time by catching issues early
  - Forces consideration of edge cases upfront

- **Implementation Workflow:**
  - Analyze task requirements from task description and testStrategy
  - First create a failing test that validates the desired outcome
  - Run the test to verify it fails (confirms test is valid)
  - Implement the minimal code needed to make test pass
  - Run the test to verify the implementation works
  - Refactor the code to improve structure and maintainability
  - Run tests again to ensure refactoring didn't break functionality
  - Repeat for next feature or requirement

- **Red-Green-Refactor Cycle:**
  - Red: Write a failing test that defines expected behavior
  - Green: Write minimum code to make the test pass
  - Refactor: Improve the code while keeping tests passing
  - This cycle should be kept tight and focused
  - Each cycle should address a single requirement or behavior
  - Don't proceed to next feature until current tests pass

- **E2E Testing with Playwright:**
  - Always use the playwright-mcp server for browser automation
  - Start with defining critical user workflows
  - Write tests that simulate real user behavior
  - Use appropriate selectors for reliable element identification
  - Test both successful paths and error scenarios
  - Include validation for UI state and displayed content
  - Structure tests to match user stories or use cases
  - Available commands:
    - `browser_navigate` - Navigate to a URL
    - `browser_click` - Click elements
    - `browser_type` - Enter text
    - `browser_wait_for` - Wait for content
    - `browser_select_option` - Select from dropdowns
    - `browser_snapshot` - Capture page state

- **Test Data Management:**
  - Create reusable test data factories or fixtures
  - Isolate tests from external systems using mocks when appropriate
  - Clean up test data after test completion
  - Use database transactions to roll back changes when possible
  - Avoid inter-test dependencies that cause flaky tests
  - Consider using dedicated test databases for integration tests

- **Continuous Testing:**
  - Run relevant tests automatically after code changes
  - Configure CI/CD pipeline to run full test suite on each commit
  - Monitor test coverage and maintain high coverage rates
  - Address failing tests immediately before continuing development
  - Use test results to guide development priorities
  - Report test status in documentation and task updates

---
CLAUDE_PARALLEL_WORK_WORKFLOW
---
description: Guide for using claude-parallel-work MCP server integration for managing test-task-driven development workflows with up to 3x faster execution through intelligent parallelization
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **MCP Server Tools Overview**
  - Claude Parallel Work provides a comprehensive set of MCP tools for parallel task execution
  - All functionality is available through MCP server tools with intelligent orchestration
  - Main tool categories:
    - Project initialization: `init_project` - Adds orchestration guidance to CLAUDE.md
    - Task execution: `task_worker` - Execute tasks in isolated containers
    - Task discovery: `get_next_tasks`, `get_tasks`, `get_task` - Find and view tasks
    - Task management: `set_task_status` - Update task progress
    - Task validation: `validate_tasks` - Verify tasks.json format
    - Change management: `review_changes`, `apply_changes`, `reject_changes`, `request_revision`
    - Monitoring: `work_status`, `system_status`, `dashboard_status`, `open_dashboard`
    - Logging: `view_container_logs`, `list_container_logs`
    - Interactive: `answer_worker_question` - Respond to Claude questions during execution

- **Development Workflow Process**
  ```mermaid
  flowchart TD
  A[Initialize Project] --> B[Create/Validate tasks.json]
  B --> C[get_next_tasks]
  C --> D[task_worker - Multiple Parallel]
  D --> E[work_status - Monitor]
  E --> F[review_changes]
  F --> G{Accept?}
  G -->|Yes| H[apply_changes]
  G -->|No| I[reject_changes or request_revision]
  H --> J[set_task_status - Done]
  I --> D
  J --> C
  ```

- **Project Initialization**
  - Run `init_project` to add orchestration guidance to CLAUDE.md
  - This embeds parallel work orchestration instructions for optimal execution
  - The guidance helps Claude determine when to use parallel vs synchronous work
  - Only needs to be run once per project

- **Task Structure and Management**
  - Tasks are defined in `tasks.json` at project root
  - Task structure includes:
    ```json
    {
      "id": 1,
      "title": "Brief title",
      "description": "One-line description",
      "status": "pending",
      "dependencies": [2, 3],
      "priority": "high",
      "details": "Detailed implementation instructions",
      "testStrategy": "How to verify completion",
      "subtasks": []
    }
    ```
  - Use `validate_tasks` to ensure proper format
  - Tasks with satisfied dependencies can run in parallel

- **Parallel Execution Workflow**
  - Use `get_next_tasks` to find ALL tasks ready for parallel execution
  - Launch multiple `task_worker` processes simultaneously for independent tasks
  - Each task runs in an isolated Docker container with full development environment
  - Monitor all executions with `work_status` while continuing other work
  - Example parallel launch:
    ```javascript
    // ✅ DO: Launch multiple independent tasks in parallel
    const readyTasks = await get_next_tasks({ workFolder: "/project" });
    
    // Launch all ready tasks simultaneously
    const taskPromises = readyTasks.map(task => 
      task_worker({
        task: `Implement ${task.title}`,
        workFolder: "/project"
      })
    );
    
    // Monitor progress
    const taskIds = await Promise.all(taskPromises);
    await work_status({ taskId: taskIds[0] });
    ```

- **Change Review and Application**
  - After tasks complete, use `review_changes` to inspect ALL modifications
  - Review shows complete diffs with risk assessment
  - Options after review:
    - `apply_changes` - Merge approved changes to workspace
    - `reject_changes` - Permanently discard changes
    - `request_revision` - Iterate on changes with feedback
  - Changes are sandboxed until explicitly applied

- **Task Status Management**
  - Update multiple tasks at once: `set_task_status ids="1,2,3" status="done"`
  - Status options: pending, in-progress, done, failed
  - Only mark tasks done after verification
  - Failed tasks include error messages for debugging

- **Container and Logging**
  - Each task runs in an isolated container
  - View execution logs with `view_container_logs`
  - List available logs with `list_container_logs`
  - Containers are automatically cleaned up after use
  - Logs persist for debugging failed tasks

- **Dashboard and Monitoring**
  - Run `open_dashboard` for visual task monitoring
  - Real-time WebSocket updates of task progress
  - Terminal interface for container logs
  - Diff preview and management interface
  - Check availability with `dashboard_status`

- **Interactive Sessions**
  - When `work_status` shows "needs_input", use `answer_worker_question`
  - Enables Claude to ask for clarification during execution
  - Maintains context within the container session
  - Useful for complex tasks requiring decisions

- **Performance Benefits**
  - Up to 3x faster execution through parallelization
  - Automatic dependency resolution
  - Safe preview before applying changes
  - Full git integration in containers
  - Resource-efficient container management

- **Best Practices**
  - Always validate tasks.json before execution
  - Launch parallel tasks as a batch for efficiency
  - Monitor long-running tasks while working on other things
  - Review all changes before applying
  - Update task status immediately after completion
  - Use revision workflow instead of reject + retry

- **When to Use Parallel Work**
  - Multi-file refactoring across codebase
  - Feature implementation with independent components
  - Large-scale updates (dependencies, APIs, migrations)
  - Test writing for different modules
  - Any task set with minimal dependencies

- **When to Work Synchronously**
  - Single file edits or quick fixes
  - Tasks with strict sequential dependencies
  - Investigation or debugging work
  - User interaction requirements
  - Simple tasks under 3 steps

---
MEMORY_MANAGEMENT
---
description: Guidelines for maintaining persistent memory using mem0-memory-mcp server for project context
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **Required Memory MCP Usage:**
  - ALWAYS use mem0-memory MCP server for persistent memory across sessions
  - $PROJECT_AGENT_NAME is the name of the project folder unless otherwise specified
  - Memory operations include:
    - `add-memory` to store new insights
    - `get-memory` to retrieve specific memories
    - `search-memories` to find relevant memories
    - `update-memory` to modify existing memories
    - `delete-memory` to remove obsolete memories

- **Memory Operation Workflow:**
  - Before starting work: Search existing memories with userId=$PROJECT_AGENT_NAME
  - After significant insights: Store using add-memory with userId=$PROJECT_AGENT_NAME
  - Update memories regularly with project state, active tasks, and key decisions
  - Format memories in structured way for easy retrieval

- **Important Learning Capture:**
  ```mermaid
  flowchart TD
  Start{Discover New Pattern} --> Learn
  subgraph Learn [Learning Process]
  D1[Identify Pattern] --> D2[Validate with User] --> D3[Create IMPORTANT_LEARNING memory]
  end
  Learn --> Apply
  subgraph Apply [Usage]
  A1[Retrieve relevant IMPORTANT_LEARNING memories] --> A2[Apply Learned Patterns] --> A3[Improve Future Work]
  end
  ```

- **Critical Insights to Capture:**
  - Implementation patterns and paths
  - User preferences and workflow
  - Project-specific conventions
  - Known challenges and solutions
  - Decision evolution history
  - Tool usage patterns and best practices

- **Memory Structure Best Practices:**
  - Use consistent tagging for easy retrieval
  - Include specific examples from codebase
  - Categorize memories by type (architecture, workflow, pattern)
  - Cross-reference related memories
  - Include timestamps and context for when insight was gained
  - Focus on actionable patterns over general information

- **Task and Memory Integration:**
  - Claude Parallel Work manages task execution and parallelization
  - Memory system stores insights, patterns, and contextual knowledge
  - Use Claude Parallel Work for all task operations (execution, monitoring)
  - Use Memory for storing learned patterns and implementation insights
  - Together they provide complete project context without redundant documentation
  - Tasks reflect current work state; Memory captures accumulated knowledge

---
PROJECT_DOCUMENTATION
---
description: Guidelines for maintaining comprehensive project documentation using memory files
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **Core Documentation Files:**
  - Architecture Document: `/docs/architecture.md` - System architecture with diagrams
  - Product Requirements: `/docs/product_requirement_docs.md` - Core problems and features
  - Technical Documentation: `/docs/technical.md` - Development environment and tech stack
  - Workflow Document: `/docs/workflow.md` - Detailed development workflow (CRITICAL)
  
Note: Current task state and progress are managed through the Claude Parallel Work system and mem0-memory-mcp persistent storage rather than separate documentation files

- **Documentation and Memory Hierarchy:**
  ```mermaid
  flowchart TD
  PB[Product Requirement Document] --> PC[Technical Document]
  PB --> SP[Architecture Document]
  PB --> WF[Workflow Document]
  
  subgraph PM[Persistent Memory]
  LL[IMPORTANT_LEARNING]
  TS[Task Status via MCP]
  ER[Error Documentation]
  end
  
  SP --> PM
  PC --> PM
  PB --> PM
  WF --> PM
  
  PM --> SP
  PM --> PC
  PM --> PB
  
  subgraph LIT[Literature /docs/literature/]
  L1[...]
  L2[...]
  end
  
  PC --o LIT
  ```

- **Documentation Update Workflow:**
  ```mermaid
  flowchart TD
  Start[Update Process]
  subgraph Process
  P1[Review Core Files]
  P4[Update IMPORTANT_LEARNING in Memory]
  P5[Update Architecture Document]
  P1 --> P4 --> P5
  end
  Start --> Process
  ```

- **Documentation Update Triggers:**
  - Discovery of new project patterns
  - After implementing significant changes
  - When user requests with "update memory files"
  - When context needs clarification
  - After significant part of Plan is verified

- **Architectural Documentation:**
  - ALWAYS maintain architecture diagram in mermaid format
  - Create architecture document if one does not exist
  - Ensure diagram includes:
    - Module boundaries and relationships
    - Data flow patterns
    - System interfaces
    - Component dependencies
  - Validate all changes against architectural constraints
  - Ensure new code maintains defined separation of concerns

---
CLAUDE.md
---
description: Guidelines for creating and maintaining CLAUDE.md RULES to ensure consistency and effectiveness.
globs: CLAUDE.md
filesToApplyRule: CLAUDE.md
alwaysApply: true
---
The below describes how you should be structuring new rule sections in this document.
- **Required Rule Structure:**
  ```markdown
  ---
  description: Clear, one-line description of what the rule enforces
  globs: path/to/files/*.ext, other/path/**/*
  alwaysApply: boolean
  ---

  - **Main Points in Bold**
    - Sub-points with details
    - Examples and explanations
  ```

- **Section References:**
  - Use `ALL_CAPS_SECTION` to reference files
  - Example: `CLAUDE.md`

- **Code Examples:**
  - Use language-specific code blocks
  ```typescript
  // ✅ DO: Show good examples
  const goodExample = true;
  
  // ❌ DON'T: Show anti-patterns
  const badExample = false;
  ```

- **Rule Content Guidelines:**
  - Start with high-level overview
  - Include specific, actionable requirements
  - Show examples of correct implementation
  - Reference existing code when possible
  - Keep rules DRY by referencing other rules

- **Rule Maintenance:**
  - Update rules when new patterns emerge
  - Add examples from actual codebase
  - Remove outdated patterns
  - Cross-reference related rules

- **Best Practices:**
  - Use bullet points for clarity
  - Keep descriptions concise
  - Include both DO and DON'T examples
  - Reference actual code over theoretical examples
  - Use consistent formatting across rules 

---
SELF_IMPROVE
---
description: Guidelines for continuously improving this rules document based on emerging code patterns and best practices.
globs: **/*
filesToApplyRule: **/*
alwaysApply: true
---

- **Rule Improvement Triggers:**
  - New code patterns not covered by existing rules
  - Repeated similar implementations across files
  - Common error patterns that could be prevented
  - New libraries or tools being used consistently
  - Emerging best practices in the codebase

- **Analysis Process:**
  - Compare new code with existing rules
  - Identify patterns that should be standardized
  - Look for references to external documentation
  - Check for consistent error handling patterns
  - Monitor test patterns and coverage

- **Rule Updates:**
  - **Add New Rules When:**
    - A new technology/pattern is used in 3+ files
    - Common bugs could be prevented by a rule
    - Code reviews repeatedly mention the same feedback
    - New security or performance patterns emerge

  - **Modify Existing Rules When:**
    - Better examples exist in the codebase
    - Additional edge cases are discovered
    - Related rules have been updated
    - Implementation details have changed

- **Example Pattern Recognition:**
  ```typescript
  // If you see repeated patterns like:
  const data = await prisma.user.findMany({
    select: { id: true, email: true },
    where: { status: 'ACTIVE' }
  });
  
  // Consider adding a PRISMA section in the CLAUDE.md file:
  // - Standard select fields
  // - Common where conditions
  // - Performance optimization patterns
  ```

- **Rule Quality Checks:**
  - Rules should be actionable and specific
  - Examples should come from actual code
  - References should be up to date
  - Patterns should be consistently enforced

- **Continuous Improvement:**
  - Monitor code review comments
  - Track common development questions
  - Update rules after major refactors
  - Add links to relevant documentation
  - Cross-reference related rules

- **Rule Deprecation:**
  - Mark outdated patterns as deprecated
  - Remove rules that no longer apply
  - Update references to deprecated rules
  - Document migration paths for old patterns

- **Documentation Updates:**
  - Keep examples synchronized with code
  - Update references to external docs
  - Maintain links between related rules
  - Document breaking changes

</RULES>

- When debugging the server please always remember to check the logs in the logs directory where the server was installed by install.sh