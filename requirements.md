# Clickup Automation Requirements

Those changes look good but let’s be super clear about what the test case should be and what constitues a successful test and the requirements for this agent and for you to be able to say that your task is complete.

Your task is not complete until you run a successful test that meets all of the below requirements. Before running the test, read through these requirements and steps, think about them deeply to understand them, first make sure the server is setup to handle all of these items, then attempt a test.

To start a new test, the clickup task should:

1. Have it’s custom fields for Branch and PR link emptied (if they have values)
2. Be set back to the “Open” status before being moved to AI DO (if it is in another status)

The Agent MUST complete all of these steps either by Claude Code doing them or the server executing them progromatically:

1. Be triggered by the ClickUp Webhook
2. Create a new Git worktree with the appropriate new branch (based on the pattern we have been using)
3. Set the ClickUp Task to In Progress
4. Do the work related to the CU task
5. Commit and push that work to the new branch
6. Create a Detailed PR to merge into main
7. Add any Manual steps that need to be completed by the Developer (i.e. database changes, running migrations, changing external configs, etc.)
8. Fill in the custom fields for Branch and Pull Request on the clickup task
9. Set the status of the ClickUp Task to Ready for Review (DEV)
10. Clean up the git worktree so that the main directory isn’t full of tmp folders (or we can add the /tmp directory to the .gitignore - you think this throuhg and make this call)

The agent MUST meet these requirements during the process:

1. Detailed logging must be created for the actions and steps taken by the server as well as by Claude Code
2. Neither Claude Code or the server should do anything destructive or dangerous - an example would be trying to run a database migration itself

Things I want but that are not deal breakers:

1. The ability for the Claude Code child process to be able to access mcp servers
2. The ability for the test URL custom field to be filled (this should be a Vercel preview deploy link that is automatically created for the PR)

There are two ClickUp tasks to use for testing.

1. 86dxp2yk7 - Start with this simple style change that shouldn’t take the agent long to complete - this is a nonsense task that doesn't actually need to be done. DO NOT EVER UPDATE ANYTHING ON THIS TASK OTHER THAN THE STATUS TO TRIGGER THE AUTOMATION.
2. 86dxfm5bz - This is an actual request from our product team and should be used as a final test to make sure the agent can complete a full task

YOU SHOULD NEVER EVER try to complete any of the requirements for the agent. They MUST be done by the agent. An example would be trying to update the custom fields to accomplish the task. This is unacceptable and doesn't help us actually fix issues.
