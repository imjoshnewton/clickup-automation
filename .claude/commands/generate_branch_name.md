# Generate Git Branch Name

Based on the `Instructions` below, take the `Variables` follow the `Run` section to generate a concise Git branch name following the specified format. Then follow the `Report` section to report the results of your work.

## Variables

issue_class: $1
adw_id: $2
issue: $3

## Instructions

- Generate a branch name in the format: `{task-id}/{issue_class}/{concise_name}`
- The `{task-id}` is the ClickUp task ID (e.g., `86dxfm5bz`)
- The `{issue_class}` should be the type: `feature`, `bug`, `chore`, or `update`
- The `{concise_name}` should be:
  - 3-6 words maximum
  - All lowercase
  - Words separated by hyphens
  - Descriptive of the main task/feature
  - No special characters except hyphens
- Examples:
  - `86dxfm5bz/feature/add-user-authentication`
  - `abc123xyz/bug/fix-login-error`
  - `def456uvw/chore/update-dependencies`
  - `ghi789rst/update/enhance-user-profile`
- Extract the task ID, title, and description from the issue JSON

## Run

Run `git checkout main` to switch to the main branch
Run `git pull` to pull the latest changes from the main branch
Run `git checkout -b <branch_name>` to create and switch to the new branch

## Report

After generating the branch name:
Return ONLY the branch name that was created (no other text)