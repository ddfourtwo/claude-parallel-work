# Orchestrate Tasks - Intelligent Parallel & Synchronous Execution

Execute all tasks from tasks.json using smart orchestration. I will maximize efficiency by working on tasks myself while managing parallel workers.

## Process Overview:
1. **Validate tasks.json** - Ensure proper format and dependencies
2. **Find ready tasks** - Identify all tasks with satisfied dependencies  
3. **Smart task distribution**:
   - Simple/quick tasks → I'll do them directly (faster than container setup)
   - Complex/long tasks → Assign to task_worker containers
   - Multiple parallel tasks → I'll work on one while workers handle others
4. **Active execution** - Work on tasks myself while monitoring workers
5. **Review & apply changes** - Inspect and merge all modifications
6. **Update status** - Mark tasks complete and find next batch
7. **Repeat** - Continue until all tasks are complete

## Execution Strategy:
- **I won't just wait** - While task_workers run, I'll actively work on other tasks
- **Smart distribution** - If 3 tasks can run in parallel:
  - Assign 2 complex ones to task_worker containers
  - I'll handle the 3rd one directly
- **Efficiency first** - Simple tasks (< 3 steps) done synchronously by me
- **Parallel for complex** - Multi-file refactoring, large features → task_worker
- **Continuous progress** - Always be executing something, never idle

## My Workflow:
```
1. validate_tasks → Ensure tasks.json is properly formatted
2. get_next_tasks → Find ALL tasks ready for execution
3. Analyze task complexity:
   - Simple (< 3 steps, single file) → Execute directly
   - Complex (multi-file, testing) → Assign to task_worker
4. Smart execution:
   - If multiple tasks available: Launch N-1 to task_workers, do 1 myself
   - If single task: Assess complexity, do it myself or use task_worker
   - ALWAYS maximize parallelization
5. As I complete my task:
   - set_task_status → Mark my task complete
   - IMMEDIATELY run get_next_tasks → Check for newly unblocked tasks
   - Launch any newly available tasks to workers
   - Check worker status for completed tasks
   - Review and apply their changes
6. Continue until all tasks complete
```

## Critical Pattern:
After EVERY task completion → get_next_tasks to find newly unblocked work!

## Task Distribution Logic:
- **Do myself**: Quick fixes, single file edits, simple updates, documentation
- **task_worker**: Feature implementation, multi-file refactoring, test suites
- **Mixed approach**: If many tasks available, always keep myself busy

## What I'll Do:
- Work continuously - no idle time waiting for workers
- Execute simple tasks directly for immediate results  
- Manage parallel workers for complex tasks
- Maintain momentum by always having active work
- Complete the entire task list as efficiently as possible

## Example Execution Pattern:
```
Step 1: get_next_tasks → Task 1 ready
        → Execute Task 1 myself (simple file creation)
        
Step 2: set_task_status id=1 status=done
        get_next_tasks → Tasks 2, 3, 5 now ready! (3 parallel)
        → Launch task_worker for Task 2 (complex components)
        → Launch task_worker for Task 3 (platform utilities)
        → Work on Task 5 myself (theme system)
        
Step 3: Complete Task 5, set_task_status id=5 status=done
        get_next_tasks → No new tasks yet
        work_status → Check Task 2 & 3 progress
        (If tasks taking >3 min: use answer_worker_question to provide guidance)
        
Step 4: Task 2 completes → review_changes → apply_changes
        set_task_status id=2 status=done
        get_next_tasks → Tasks 4, 6, 7, 8 now ready! (4 parallel)
        → Launch 3 more task_workers, work on 1 myself
```

## Monitoring Long-Running Tasks:
When monitoring task_workers:
1. **Use work_status** to check duration and status
2. **Use view_container_logs** to see heartbeat logs (every 30s) and progress
3. **If status = "needs_input"**: Use answer_worker_question to respond to Claude's question
4. **If status = "running" for >5 minutes**: Task is complex but progressing (check heartbeat logs)

## Task Status Types:
- **running**: Task executing normally (check heartbeat in logs)
- **needs_input**: Claude is asking a question (respond with answer_worker_question)
- **completed**: Ready for review_changes and apply_changes
- **failed**: Check logs for errors

Ready to orchestrate! I'll validate tasks.json and maximize parallelization. I will NOT stop working until ALL tasks are complete. I MUST complete all tasks.