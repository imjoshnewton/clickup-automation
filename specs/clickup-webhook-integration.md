# ClickUp Webhook Integration - Technical Specification

**Version:** 1.0
**Date:** 2025-10-13
**Status:** Draft
**Author:** AI Developer Workflow System

---

## 1. Executive Summary

### 1.1 Objective
Add ClickUp webhook support to the existing AI Developer Workflow (ADW) system while **preserving all existing GitHub webhook functionality**. The system will support both platforms simultaneously, allowing developers to trigger automation from either GitHub issues or ClickUp tasks.

### 1.2 Design Principles
- **No Breaking Changes:** All existing GitHub functionality remains intact
- **Code Reuse:** Share common orchestration logic between platforms
- **Platform Abstraction:** Design interfaces that work for both GitHub and ClickUp
- **Feature Parity:** ClickUp implementation should match GitHub capabilities
- **Maintainability:** Clear separation of concerns, minimal code duplication

### 1.3 Success Criteria
- ✅ ClickUp webhooks trigger ADW workflows
- ✅ GitHub webhooks continue to work unchanged
- ✅ Both platforms can be used simultaneously
- ✅ Task/issue comments show progress in respective platforms
- ✅ All tests pass for both platforms
- ✅ Health checks validate both GitHub and ClickUp configurations

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TRIGGER LAYER                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────┐           ┌────────────────────┐   │
│  │  GitHub Webhook    │           │  ClickUp Webhook   │   │
│  │  /gh-webhook       │           │  /clickup-webhook  │   │
│  │  (EXISTING)        │           │  (NEW)             │   │
│  └────────┬───────────┘           └────────┬───────────┘   │
│           │                                 │               │
│           │                                 │               │
└───────────┼─────────────────────────────────┼───────────────┘
            │                                 │
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│ adw_plan_build.py     │         │ adw_plan_build.py     │
│ --platform=github     │         │ --platform=clickup    │
│ --issue=123           │         │ --task-id=abc123      │
└───────────┬───────────┘         └───────────┬───────────┘
            │                                 │
┌───────────┼─────────────────────────────────┼───────────────┐
│                  PLATFORM ABSTRACTION LAYER                  │
├───────────┼─────────────────────────────────┼───────────────┤
│           │                                 │               │
│  ┌────────▼──────────┐           ┌─────────▼─────────┐    │
│  │   github.py       │           │   clickup.py      │    │
│  │   (EXISTING)      │           │   (NEW)           │    │
│  │                   │           │                   │    │
│  │ - fetch_issue()   │           │ - get_task()      │    │
│  │ - make_comment()  │           │ - add_comment()   │    │
│  │ - mark_progress() │           │ - update_status() │    │
│  └───────────────────┘           └───────────────────┘    │
│                                                             │
│  ┌──────────────────────────────────────────────────┐     │
│  │         platform_adapter.py (NEW)                │     │
│  │         Unified interface for both platforms     │     │
│  │                                                   │     │
│  │ PlatformAdapter (Abstract Base Class)            │     │
│  │ ├── GitHubAdapter                                │     │
│  │ └── ClickUpAdapter                               │     │
│  └──────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
            │
┌───────────┼──────────────────────────────────────────────────┐
│                  SHARED ORCHESTRATION LAYER                   │
├───────────┼──────────────────────────────────────────────────┤
│           │                                                   │
│  1. Classify work item (issue/task)                          │
│  2. Create git branch                                         │
│  3. Build plan (/feature, /bug, /chore)                      │
│  4. Commit plan                                               │
│  5. Implement plan (/implement)                              │
│  6. Commit implementation                                     │
│  7. Create PR                                                 │
│  8. Update work item (status, custom fields, comments)       │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 Module Structure

```
clickup-automation/
├── adws/
│   ├── trigger_webhook.py        (EXISTING - GitHub webhooks)
│   ├── trigger_clickup_webhook.py (NEW - ClickUp webhooks)
│   ├── github.py                  (EXISTING - No changes)
│   ├── clickup.py                 (NEW - ClickUp operations)
│   ├── platform_adapter.py        (NEW - Abstraction layer)
│   ├── adw_plan_build.py          (MODIFIED - Add platform support)
│   ├── agent.py                   (EXISTING - No changes)
│   ├── data_types.py              (MODIFIED - Add ClickUp models)
│   ├── utils.py                   (EXISTING - No changes)
│   └── health_check.py            (MODIFIED - Add ClickUp checks)
├── .claude/
│   ├── commands/
│   │   ├── classify_issue.md     (EXISTING - Works for both)
│   │   ├── feature.md             (EXISTING - Works for both)
│   │   ├── bug.md                 (EXISTING - Works for both)
│   │   ├── chore.md               (EXISTING - Works for both)
│   │   ├── implement.md           (EXISTING - Works for both)
│   │   └── ...                    (EXISTING - No changes needed)
│   └── settings.json              (EXISTING - No changes)
├── specs/
│   └── clickup-webhook-integration.md (THIS FILE)
└── .env
```

---

## 3. Detailed Component Specifications

### 3.1 New Module: `adws/clickup.py`

**Purpose:** ClickUp-specific API operations (parallel to github.py)

**Dependencies:**
```python
# /// script
# dependencies = ["python-dotenv", "pydantic"]
# ///
```

**Key Functions:**

```python
def get_clickup_env() -> Optional[dict]:
    """
    Get environment with ClickUp API key configured.
    Similar to github.get_github_env()

    Returns:
        Optional[dict]: Environment dict with CLICKUP_API_KEY, or None
    """

def get_task(task_id: str) -> ClickUpTask:
    """
    Fetch ClickUp task details using MCP tools or direct API.
    Parallel to github.fetch_issue()

    Args:
        task_id: ClickUp task ID (e.g., "abc123")

    Returns:
        ClickUpTask: Typed Pydantic model with task details

    Implementation Options:
        Option A: Use mcp__clickup__get_task (preferred)
        Option B: Direct HTTPS API call
    """

def add_task_comment(task_id: str, comment: str) -> None:
    """
    Post a comment to a ClickUp task.
    Parallel to github.make_issue_comment()

    Args:
        task_id: ClickUp task ID
        comment: Comment text (supports markdown)

    Implementation:
        Use mcp__clickup__add_comment
    """

def update_task_status(task_id: str, status: str) -> None:
    """
    Update ClickUp task status.
    Parallel to github.mark_issue_in_progress()

    Args:
        task_id: ClickUp task ID
        status: Status name (e.g., "in progress", "Ready for Review (DEV)")

    Implementation:
        Use mcp__clickup__update_task_status
    """

def set_task_custom_field(task_id: str, list_id: str, field_name: str, value: any) -> None:
    """
    Set custom field value on ClickUp task.

    Args:
        task_id: ClickUp task ID
        list_id: ClickUp list ID (needed for field lookup)
        field_name: Custom field name (e.g., "GitHub Branch")
        value: Field value

    Implementation:
        Use mcp__clickup__set_custom_field_value_by_name
    """

def get_list_id_from_task(task_id: str) -> str:
    """
    Helper to extract list_id from task (needed for custom fields).

    Args:
        task_id: ClickUp task ID

    Returns:
        str: List ID containing the task
    """

def extract_task_type(task: ClickUpTask) -> str:
    """
    Determine task type from tags or custom fields.
    Returns: "feature", "bug", "chore", "update"

    Logic:
        1. Check for task tags (bug, feature, chore)
        2. Check custom field "Type"
        3. Analyze task name/description (fallback)
    """
```

**Error Handling:**
- Raise `ClickUpAPIError` for API failures
- Raise `TaskNotFoundError` for invalid task IDs
- Log all errors with context

**Testing:**
- Unit tests with mocked MCP responses
- Integration tests with real ClickUp API (test workspace)

---

### 3.2 New Module: `adws/trigger_clickup_webhook.py`

**Purpose:** ClickUp webhook server (parallel to trigger_webhook.py)

**Dependencies:**
```python
# /// script
# dependencies = ["fastapi", "uvicorn", "python-dotenv"]
# ///
```

**Endpoints:**

```python
@app.post("/clickup-webhook")
async def clickup_webhook(request: Request):
    """
    Handle ClickUp webhook events.

    Webhook Events to Handle:
        - taskCreated: New task created
        - taskCommentPosted: Comment added to task

    Trigger Conditions:
        1. New task created in configured list
        2. Comment with text "adw" (case-insensitive, trimmed)

    Security:
        - Verify X-Signature header against CLICKUP_WEBHOOK_SECRET
        - Optional: IP whitelist (ClickUp IPs if available)

    Response:
        - Return 200 immediately (within 10 seconds)
        - Launch adw_plan_build.py in background

    Returns:
        {
            "status": "accepted",
            "task_id": "abc123",
            "adw_id": "xyz789",
            "message": "ADW workflow triggered for task #abc123",
            "logs": "agents/xyz789/adw_plan_build/"
        }
    """

@app.get("/health")
async def health():
    """
    Health check endpoint (same as GitHub version).
    Runs comprehensive health check including ClickUp validation.
    """
```

**Signature Verification:**
```python
def verify_clickup_signature(payload: bytes, signature: str) -> bool:
    """
    Verify ClickUp webhook signature.

    ClickUp signature format (from server.ts analysis):
        Simple token comparison: signature == CLICKUP_WEBHOOK_SECRET

    Args:
        payload: Raw request body
        signature: X-Signature header value

    Returns:
        bool: True if signature is valid
    """
    # Simple comparison (not HMAC like GitHub)
    return signature == os.getenv("CLICKUP_WEBHOOK_SECRET")
```

**Background Process Launch:**
```python
# Launch adw_plan_build.py with platform flag
cmd = [
    "uv", "run",
    "adws/adw_plan_build.py",
    "--platform", "clickup",
    "--task-id", task_id,
    "--adw-id", adw_id
]

subprocess.Popen(cmd, cwd=project_root, env=os.environ.copy())
```

**Configuration:**
```bash
# .env
PORT=8001                          # Can use same port as GitHub (handles both)
CLICKUP_WEBHOOK_SECRET=your-secret
CLICKUP_API_KEY=your-api-key
CLICKUP_LIST_ID=optional-list-id   # Optional: only process tasks from this list
```

---

### 3.3 New Module: `adws/platform_adapter.py`

**Purpose:** Unified interface for both GitHub and ClickUp operations

**Design Pattern:** Adapter Pattern with Abstract Base Class

**Implementation:**

```python
#!/usr/bin/env -S uv run
# /// script
# dependencies = ["python-dotenv", "pydantic"]
# ///

"""
Platform Adapter - Unified interface for GitHub and ClickUp operations.

Provides a common interface for work item operations (issues/tasks),
allowing the orchestrator to work with either platform transparently.
"""

from abc import ABC, abstractmethod
from typing import Dict, Optional
from data_types import WorkItem, WorkItemComment
from pydantic import BaseModel


class PlatformAdapter(ABC):
    """Abstract base class for platform adapters."""

    @abstractmethod
    def get_work_item(self, item_id: str) -> WorkItem:
        """Fetch work item (issue or task) by ID."""
        pass

    @abstractmethod
    def add_comment(self, item_id: str, comment: str) -> None:
        """Add comment to work item."""
        pass

    @abstractmethod
    def update_status(self, item_id: str, status: str) -> None:
        """Update work item status."""
        pass

    @abstractmethod
    def set_custom_field(self, item_id: str, field_name: str, value: any) -> None:
        """Set custom field on work item."""
        pass

    @abstractmethod
    def get_platform_name(self) -> str:
        """Return platform name ('github' or 'clickup')."""
        pass


class GitHubAdapter(PlatformAdapter):
    """Adapter for GitHub operations."""

    def __init__(self, repo_path: str):
        self.repo_path = repo_path

    def get_work_item(self, item_id: str) -> WorkItem:
        """Fetch GitHub issue."""
        from github import fetch_issue
        github_issue = fetch_issue(item_id, self.repo_path)

        # Convert GitHubIssue to generic WorkItem
        return WorkItem(
            id=str(github_issue.number),
            title=github_issue.title,
            description=github_issue.body or "",
            status=github_issue.state,
            platform="github",
            raw_data=github_issue.dict()
        )

    def add_comment(self, item_id: str, comment: str) -> None:
        """Add comment to GitHub issue."""
        from github import make_issue_comment
        make_issue_comment(item_id, comment)

    def update_status(self, item_id: str, status: str) -> None:
        """Update GitHub issue status (add label, assign)."""
        from github import mark_issue_in_progress
        mark_issue_in_progress(item_id)

    def set_custom_field(self, item_id: str, field_name: str, value: any) -> None:
        """GitHub doesn't have custom fields - no-op or use labels."""
        print(f"GitHub: Cannot set custom field '{field_name}' (not supported)")

    def get_platform_name(self) -> str:
        return "github"


class ClickUpAdapter(PlatformAdapter):
    """Adapter for ClickUp operations."""

    def __init__(self, list_id: Optional[str] = None):
        self.list_id = list_id  # Needed for custom fields

    def get_work_item(self, item_id: str) -> WorkItem:
        """Fetch ClickUp task."""
        from clickup import get_task
        clickup_task = get_task(item_id)

        # Convert ClickUpTask to generic WorkItem
        return WorkItem(
            id=clickup_task.id,
            title=clickup_task.name,
            description=clickup_task.description or clickup_task.text_content or "",
            status=clickup_task.status.get("status", "unknown"),
            platform="clickup",
            raw_data=clickup_task.dict()
        )

    def add_comment(self, item_id: str, comment: str) -> None:
        """Add comment to ClickUp task."""
        from clickup import add_task_comment
        add_task_comment(item_id, comment)

    def update_status(self, item_id: str, status: str) -> None:
        """Update ClickUp task status."""
        from clickup import update_task_status
        update_task_status(item_id, status)

    def set_custom_field(self, item_id: str, field_name: str, value: any) -> None:
        """Set ClickUp custom field."""
        from clickup import set_task_custom_field, get_list_id_from_task

        # Get list_id if not provided
        list_id = self.list_id
        if not list_id:
            list_id = get_list_id_from_task(item_id)

        set_task_custom_field(item_id, list_id, field_name, value)

    def get_platform_name(self) -> str:
        return "clickup"


def create_adapter(platform: str, **kwargs) -> PlatformAdapter:
    """
    Factory function to create appropriate adapter.

    Args:
        platform: "github" or "clickup"
        **kwargs: Platform-specific arguments
            - repo_path: For GitHub
            - list_id: For ClickUp (optional)

    Returns:
        PlatformAdapter: Configured adapter instance
    """
    if platform == "github":
        repo_path = kwargs.get("repo_path")
        if not repo_path:
            from github import get_repo_url, extract_repo_path
            github_url = get_repo_url()
            repo_path = extract_repo_path(github_url)
        return GitHubAdapter(repo_path)

    elif platform == "clickup":
        list_id = kwargs.get("list_id")
        return ClickUpAdapter(list_id)

    else:
        raise ValueError(f"Unsupported platform: {platform}")
```

---

### 3.4 Modified Module: `adws/data_types.py`

**Changes:** Add ClickUp models and generic WorkItem

**New Models:**

```python
class ClickUpStatus(BaseModel):
    """ClickUp task status."""
    status: str
    color: str
    orderindex: int
    type: str

class ClickUpCustomField(BaseModel):
    """ClickUp custom field."""
    id: str
    name: str
    type: str
    value: Optional[any] = None
    type_config: Optional[Dict] = None

class ClickUpUser(BaseModel):
    """ClickUp user."""
    id: int
    username: str
    email: Optional[str] = None
    color: Optional[str] = None
    profilePicture: Optional[str] = None

class ClickUpTag(BaseModel):
    """ClickUp tag."""
    name: str
    tag_fg: str
    tag_bg: str

class ClickUpTask(BaseModel):
    """ClickUp task details."""
    id: str
    name: str
    description: Optional[str] = None
    text_content: Optional[str] = None
    status: ClickUpStatus
    orderindex: str
    date_created: str
    date_updated: str
    date_closed: Optional[str] = None
    creator: ClickUpUser
    assignees: List[ClickUpUser] = []
    tags: List[ClickUpTag] = []
    custom_fields: List[ClickUpCustomField] = []
    list: Dict  # Contains list info including id
    url: str

class ClickUpComment(BaseModel):
    """ClickUp task comment."""
    id: str
    comment_text: str
    user: ClickUpUser
    date: str

# Generic WorkItem for platform abstraction
class WorkItem(BaseModel):
    """
    Generic work item (GitHub issue or ClickUp task).
    Used by platform adapters for unified interface.
    """
    id: str
    title: str
    description: str
    status: str
    platform: str  # "github" or "clickup"
    raw_data: Dict  # Original platform-specific data
```

**Existing Models:** Keep all GitHub models unchanged

---

### 3.5 Modified Module: `adws/adw_plan_build.py`

**Changes:** Add platform support via command-line flags

**New CLI Interface:**

```python
#!/usr/bin/env -S uv run
# /// script
# dependencies = ["python-dotenv", "pydantic"]
# ///

"""
ADW Plan & Build - Main workflow orchestrator.

Supports both GitHub issues and ClickUp tasks via platform adapter.

Usage:
    # GitHub (existing)
    uv run adw_plan_build.py <issue_number> <adw_id>
    uv run adw_plan_build.py --platform github --issue 123 --adw-id xyz

    # ClickUp (new)
    uv run adw_plan_build.py --platform clickup --task-id abc123 --adw-id xyz
"""

import argparse

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="ADW Plan & Build Orchestrator")

    # Platform selection
    parser.add_argument(
        "--platform",
        choices=["github", "clickup"],
        default="github",
        help="Platform to use (github or clickup)"
    )

    # Work item identifier (issue number or task ID)
    parser.add_argument(
        "--issue",
        type=str,
        help="GitHub issue number (for --platform github)"
    )
    parser.add_argument(
        "--task-id",
        type=str,
        help="ClickUp task ID (for --platform clickup)"
    )

    # ADW workflow ID
    parser.add_argument(
        "--adw-id",
        type=str,
        required=True,
        help="ADW workflow ID (generated by webhook trigger)"
    )

    # Backward compatibility: positional args
    parser.add_argument(
        "legacy_issue",
        nargs="?",
        help="Legacy: issue number (positional arg 1)"
    )
    parser.add_argument(
        "legacy_adw_id",
        nargs="?",
        help="Legacy: ADW ID (positional arg 2)"
    )

    args = parser.parse_args()

    # Handle legacy positional arguments
    if args.legacy_issue and args.legacy_adw_id:
        args.platform = "github"
        args.issue = args.legacy_issue
        args.adw_id = args.legacy_adw_id

    # Validate arguments
    if args.platform == "github" and not args.issue:
        parser.error("--issue is required for --platform github")
    if args.platform == "clickup" and not args.task_id:
        parser.error("--task-id is required for --platform clickup")

    return args
```

**Main Workflow Updates:**

```python
def main():
    args = parse_args()

    # Set up logging
    logger = setup_logger(args.adw_id, "adw_plan_build")
    logger.info(f"Starting ADW workflow: platform={args.platform}, adw_id={args.adw_id}")

    # Create platform adapter
    from platform_adapter import create_adapter

    if args.platform == "github":
        item_id = args.issue
        adapter = create_adapter("github")
    else:  # clickup
        item_id = args.task_id
        list_id = os.getenv("CLICKUP_LIST_ID")  # Optional
        adapter = create_adapter("clickup", list_id=list_id)

    logger.info(f"Using {adapter.get_platform_name()} adapter for item {item_id}")

    # Fetch work item (issue or task)
    work_item = adapter.get_work_item(item_id)
    logger.info(f"Fetched work item: {work_item.title}")

    # Post starting comment
    adapter.add_comment(item_id, f"🚀 {args.adw_id}_adw_plan_build: Starting automation workflow")

    # Update status to in progress
    adapter.update_status(item_id, "in progress")

    # === STAGE 1: Classify work item ===
    logger.info("Stage 1: Classifying work item")
    adapter.add_comment(item_id, f"📋 {args.adw_id}_issue_classifier: Analyzing work item type")

    issue_type = classify_issue(args.adw_id, work_item)
    logger.info(f"Work item classified as: {issue_type}")

    # === STAGE 2: Generate branch name ===
    logger.info("Stage 2: Generating branch name")

    branch_name = git_branch(args.adw_id, work_item, item_id)
    logger.info(f"Branch name: {branch_name}")

    # === STAGE 3: Build implementation plan ===
    logger.info("Stage 3: Building implementation plan")
    adapter.add_comment(item_id, f"📝 {args.adw_id}_sdlc_planner: Creating implementation plan")

    plan_output = build_plan(args.adw_id, work_item, issue_type)

    # === STAGE 4: Commit plan ===
    logger.info("Stage 4: Committing plan")

    git_commit(args.adw_id, f"docs: Add implementation plan for {adapter.get_platform_name()} item {item_id}")

    # === STAGE 5: Find plan file ===
    plan_file = get_plan_file(args.adw_id, plan_output)
    logger.info(f"Plan file: {plan_file}")

    # === STAGE 6: Implement plan ===
    logger.info("Stage 6: Implementing plan")
    adapter.add_comment(item_id, f"⚙️ {args.adw_id}_sdlc_implementor: Implementing solution")

    implement_plan(args.adw_id, plan_file)

    # === STAGE 7: Commit implementation ===
    logger.info("Stage 7: Committing implementation")

    git_commit(args.adw_id, f"{issue_type}: Implement solution for {adapter.get_platform_name()} item {item_id}")

    # === STAGE 8: Create pull request ===
    logger.info("Stage 8: Creating pull request")
    adapter.add_comment(item_id, f"🔧 {args.adw_id}_pr_creator: Creating pull request")

    pr_url = pull_request(args.adw_id, work_item, item_id, adapter.get_platform_name())
    logger.info(f"Pull request created: {pr_url}")

    # === STAGE 9: Update work item with PR details ===
    logger.info("Stage 9: Updating work item")

    # Set custom fields (if supported)
    try:
        adapter.set_custom_field(item_id, "GitHub Branch", branch_name)
        adapter.set_custom_field(item_id, "GitHub Pull Request URL", pr_url)
    except Exception as e:
        logger.warning(f"Could not set custom fields: {e}")

    # Update status
    adapter.update_status(item_id, "Ready for Review (DEV)")

    # Final comment
    adapter.add_comment(
        item_id,
        f"✅ {args.adw_id}_adw_plan_build: Automation complete!\n\n"
        f"📦 Pull Request: {pr_url}\n"
        f"🌿 Branch: `{branch_name}`\n\n"
        f"Ready for review!"
    )

    logger.info("ADW workflow completed successfully")

if __name__ == "__main__":
    main()
```

**Helper Function Updates:**

All helper functions (`classify_issue`, `build_plan`, `implement_plan`, etc.) remain unchanged - they work with generic `WorkItem` objects and don't need to know about the platform.

---

### 3.6 Modified Module: `adws/health_check.py`

**Changes:** Add ClickUp validation checks

**New Functions:**

```python
def check_clickup_api() -> dict:
    """
    Check ClickUp API connectivity and authentication.

    Returns:
        dict: {
            "success": bool,
            "api_key_configured": bool,
            "api_accessible": bool,
            "details": str
        }
    """
    api_key = os.getenv("CLICKUP_API_KEY")

    if not api_key:
        return {
            "success": False,
            "api_key_configured": False,
            "api_accessible": False,
            "details": "CLICKUP_API_KEY not set in environment"
        }

    try:
        # Test API access by fetching workspaces
        from clickup import get_task

        # Try to get a test task (if CLICKUP_TEST_TASK_ID is set)
        test_task_id = os.getenv("CLICKUP_TEST_TASK_ID")
        if test_task_id:
            task = get_task(test_task_id)
            return {
                "success": True,
                "api_key_configured": True,
                "api_accessible": True,
                "details": f"Successfully fetched test task: {task.name}"
            }
        else:
            # Just check if API key format is valid
            return {
                "success": True,
                "api_key_configured": True,
                "api_accessible": "unknown",
                "details": "API key configured (set CLICKUP_TEST_TASK_ID to test access)"
            }

    except Exception as e:
        return {
            "success": False,
            "api_key_configured": True,
            "api_accessible": False,
            "details": f"API access failed: {str(e)}"
        }

def check_platform_config(platform: str) -> dict:
    """
    Check configuration for specific platform.

    Args:
        platform: "github" or "clickup"

    Returns:
        dict: Platform-specific health check results
    """
    if platform == "github":
        return {
            "github_cli": check_github_cli(),
            "git_repo": check_git_repo()
        }
    elif platform == "clickup":
        return {
            "clickup_api": check_clickup_api()
        }
    else:
        return {"error": f"Unknown platform: {platform}"}
```

**Updated Main Health Check:**

```python
def run_health_check(platform: Optional[str] = None) -> dict:
    """
    Run comprehensive health check.

    Args:
        platform: Optional platform to check ("github", "clickup", or None for both)

    Returns:
        dict: Health check results
    """
    results = {
        "timestamp": datetime.now().isoformat(),
        "overall_status": "healthy",
        "checks": {}
    }

    # Always check common dependencies
    results["checks"]["environment"] = check_env_vars()
    results["checks"]["claude_code"] = check_claude_code()

    # Platform-specific checks
    if platform is None or platform == "github":
        results["checks"]["github"] = check_platform_config("github")

    if platform is None or platform == "clickup":
        results["checks"]["clickup"] = check_platform_config("clickup")

    # Determine overall status
    for check_name, check_result in results["checks"].items():
        if isinstance(check_result, dict) and not check_result.get("success", True):
            results["overall_status"] = "unhealthy"
            break

    return results
```

**CLI Updates:**

```bash
# Check all platforms
uv run adws/health_check.py

# Check specific platform
uv run adws/health_check.py --platform github
uv run adws/health_check.py --platform clickup
```

---

### 3.7 Slash Commands Updates

**Strategy:** Minimal or no changes required

**Rationale:**
- Commands use generic terms: "work on this task", "implement this plan"
- Don't need to explicitly mention "GitHub issue" or "ClickUp task"
- Context is passed via prompt, not hardcoded in commands

**Optional Updates (for clarity):**

**`/classify_issue`** → Keep name, update description
```markdown
Analyze this work item (GitHub issue or ClickUp task) and classify it as:
- `/feature` - New functionality
- `/bug` - Bug fix
- `/chore` - Maintenance/refactoring
- `/update` - Enhancement

Return ONLY the slash command, nothing else.
```

**`/feature`, `/bug`, `/chore`** → Add context variable
```markdown
You are creating an implementation plan for this work item.

**Work Item Details:**
$WORK_ITEM_JSON

Create a detailed plan...
```

**No Breaking Changes:** Existing commands continue to work with GitHub

---

## 4. Data Flow Diagrams

### 4.1 ClickUp Webhook Flow

```
┌─────────────┐
│   ClickUp   │
│   Webhook   │
└──────┬──────┘
       │ HTTP POST
       │ {event: "taskCommentPosted", task_id: "abc123"}
       ▼
┌─────────────────────────┐
│ trigger_clickup_webhook │
│ /clickup-webhook        │
└──────┬──────────────────┘
       │ 1. Verify signature
       │ 2. Extract task_id
       │ 3. Check trigger condition
       │ 4. Return 200 OK
       │ 5. Launch background process
       ▼
┌─────────────────────────┐
│ subprocess.Popen()      │
│ adw_plan_build.py       │
│ --platform clickup      │
│ --task-id abc123        │
│ --adw-id xyz789         │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ adw_plan_build.py       │
│ main()                  │
└──────┬──────────────────┘
       │ 1. Parse args
       │ 2. Create ClickUpAdapter
       │ 3. Fetch task
       ▼
┌─────────────────────────┐
│ ClickUpAdapter          │
│ get_work_item()         │
└──────┬──────────────────┘
       │ ┌─────────────────┐
       ├─┤ clickup.py      │
       │ │ get_task()      │
       │ └─────────────────┘
       │ ┌─────────────────┐
       ├─┤ MCP ClickUp     │
       │ │ get_task        │
       │ └─────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Workflow Stages         │
│ 1. Classify             │
│ 2. Branch               │
│ 3. Plan                 │
│ 4. Implement            │
│ 5. PR                   │
│ 6. Update task          │
└──────┬──────────────────┘
       │
       │ Each stage:
       ├─▶ adapter.add_comment()
       ├─▶ adapter.update_status()
       └─▶ adapter.set_custom_field()
       │
       ▼
┌─────────────────────────┐
│ ClickUpAdapter          │
│ add_comment()           │
│ update_status()         │
│ set_custom_field()      │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ clickup.py              │
│ add_task_comment()      │
│ update_task_status()    │
│ set_task_custom_field() │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ MCP ClickUp Tools       │
│ mcp__clickup__*         │
└─────────────────────────┘
```

### 4.2 GitHub Webhook Flow (Unchanged)

```
┌─────────────┐
│   GitHub    │
│   Webhook   │
└──────┬──────┘
       │ HTTP POST
       │ {action: "opened", issue: {number: 123}}
       ▼
┌─────────────────────────┐
│ trigger_webhook.py      │
│ /gh-webhook             │
└──────┬──────────────────┘
       │ (Same as before - NO CHANGES)
       ▼
┌─────────────────────────┐
│ adw_plan_build.py       │
│ --platform github       │ ← New flag (default)
│ --issue 123             │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ GitHubAdapter           │
│ (wraps github.py)       │
└─────────────────────────┘
```

---

## 5. Implementation Plan

### 5.1 Phase 1: Foundation (Core Infrastructure)

**Objective:** Create base modules without breaking existing functionality

**Tasks:**
1. ✅ Create `adws/clickup.py` with basic functions
   - `get_task()`, `add_task_comment()`, `update_task_status()`
   - Use MCP tools for ClickUp API
   - Add comprehensive error handling
   - Write unit tests with mocked MCP

2. ✅ Create `adws/platform_adapter.py`
   - Implement `PlatformAdapter` abstract class
   - Implement `GitHubAdapter` (wrapper around existing github.py)
   - Implement `ClickUpAdapter` (uses new clickup.py)
   - Write unit tests for both adapters

3. ✅ Update `adws/data_types.py`
   - Add ClickUp models (`ClickUpTask`, `ClickUpComment`, etc.)
   - Add generic `WorkItem` model
   - Maintain backward compatibility with existing models

**Validation:**
- All existing tests pass
- No changes to github.py
- No changes to existing webhooks

**Estimated Time:** 4-5 hours

---

### 5.2 Phase 2: Webhook Integration

**Objective:** Add ClickUp webhook endpoint

**Tasks:**
1. ✅ Create `adws/trigger_clickup_webhook.py`
   - Implement `/clickup-webhook` endpoint
   - Signature verification
   - Event filtering (taskCreated, taskCommentPosted)
   - Background process launch
   - Health check endpoint

2. ✅ Update `.env.example` and documentation
   - Add ClickUp environment variables
   - Document webhook setup process
   - Keep GitHub variables documented

3. ✅ Manual testing
   - Set up test ClickUp webhook
   - Trigger webhook manually
   - Verify background process launches

**Validation:**
- ClickUp webhook receives events
- Signature verification works
- Background process launches correctly
- GitHub webhooks still work (regression test)

**Estimated Time:** 2-3 hours

---

### 5.3 Phase 3: Orchestrator Updates

**Objective:** Update adw_plan_build.py to support both platforms

**Tasks:**
1. ✅ Update `adws/adw_plan_build.py`
   - Add CLI argument parsing (`--platform`, `--task-id`)
   - Maintain backward compatibility (positional args)
   - Use platform adapter throughout workflow
   - Update all stages to use adapter methods

2. ✅ Update helper functions
   - `classify_issue()` - Accept generic WorkItem
   - `build_plan()` - Accept generic WorkItem
   - `implement_plan()` - No changes needed
   - `pull_request()` - Add platform context to PR description

3. ✅ Update error handling
   - Platform-aware error messages
   - Fallback to platform-specific error reporting

**Validation:**
- Run full workflow with GitHub (backward compatibility)
- Run full workflow with ClickUp (new functionality)
- All stages complete successfully for both platforms

**Estimated Time:** 4-5 hours

---

### 5.4 Phase 4: Health Checks & Testing

**Objective:** Comprehensive validation of both platforms

**Tasks:**
1. ✅ Update `adws/health_check.py`
   - Add `check_clickup_api()`
   - Add platform-specific checks
   - Update CLI to support `--platform` flag

2. ✅ End-to-end testing
   - Create test ClickUp task
   - Trigger automation
   - Verify all stages complete
   - Verify ClickUp task gets updated

3. ✅ Regression testing
   - Test GitHub workflow
   - Verify no breaking changes
   - Test error scenarios

4. ✅ Documentation
   - Update README with ClickUp setup
   - Document both platforms
   - Add troubleshooting guide

**Validation:**
- Health check passes for both platforms
- Full workflow works end-to-end
- All edge cases handled
- Documentation is complete

**Estimated Time:** 3-4 hours

---

### 5.5 Phase 5: Polish & Deploy

**Objective:** Production readiness

**Tasks:**
1. ✅ Code review
   - Review all changes
   - Check for code duplication
   - Verify error handling

2. ✅ Performance testing
   - Test concurrent webhooks (GitHub + ClickUp)
   - Check resource usage
   - Optimize if needed

3. ✅ Deployment preparation
   - Update deployment scripts
   - Document environment setup
   - Create migration guide

4. ✅ Production deployment
   - Deploy webhook servers
   - Configure ClickUp webhooks
   - Monitor initial runs

**Validation:**
- Code meets quality standards
- System handles load
- Monitoring in place
- Production stable

**Estimated Time:** 2-3 hours

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Module: `adws/clickup.py`**
```python
# test_clickup.py
def test_get_task():
    """Test fetching ClickUp task with mocked MCP."""
    # Mock mcp__clickup__get_task
    # Verify ClickUpTask model returned

def test_add_task_comment():
    """Test adding comment to task."""
    # Mock mcp__clickup__add_comment
    # Verify comment posted

def test_update_task_status():
    """Test updating task status."""
    # Mock mcp__clickup__update_task_status
    # Verify status updated
```

**Module: `adws/platform_adapter.py`**
```python
# test_platform_adapter.py
def test_github_adapter():
    """Test GitHubAdapter wraps github.py correctly."""
    # Mock github module functions
    # Verify adapter methods work

def test_clickup_adapter():
    """Test ClickUpAdapter wraps clickup.py correctly."""
    # Mock clickup module functions
    # Verify adapter methods work

def test_create_adapter():
    """Test factory function."""
    # Verify correct adapter returned for each platform
```

**Module: `adws/adw_plan_build.py`**
```python
# test_adw_plan_build.py
def test_parse_args_github():
    """Test argument parsing for GitHub."""
    # Test positional args (backward compat)
    # Test --platform github --issue

def test_parse_args_clickup():
    """Test argument parsing for ClickUp."""
    # Test --platform clickup --task-id
```

### 6.2 Integration Tests

**Test: ClickUp Webhook → Orchestrator**
```python
def test_clickup_webhook_trigger():
    """Test ClickUp webhook triggers workflow."""
    # Send test webhook to /clickup-webhook
    # Verify 200 response
    # Verify background process launched
    # Check logs for adw_id
```

**Test: Full Workflow with ClickUp**
```python
def test_full_clickup_workflow():
    """Test complete workflow from task to PR."""
    # Create test ClickUp task
    # Trigger webhook
    # Wait for completion (or mock stages)
    # Verify:
    #   - Task comments added
    #   - Task status updated
    #   - Custom fields set
    #   - PR created
```

### 6.3 Regression Tests

**Test: GitHub Workflow Still Works**
```python
def test_github_workflow_unchanged():
    """Verify GitHub workflow works after changes."""
    # Trigger GitHub webhook
    # Verify workflow completes
    # Compare with baseline
```

### 6.4 Manual Testing Checklist

- [ ] ClickUp webhook receives events
- [ ] Signature verification works
- [ ] Task comments appear in ClickUp
- [ ] Task status updates in ClickUp
- [ ] Custom fields update in ClickUp
- [ ] GitHub webhooks still work
- [ ] Health check passes for both platforms
- [ ] Error messages are clear
- [ ] Logs are readable
- [ ] Documentation is accurate

---

## 7. Configuration & Environment

### 7.1 Environment Variables

**Updated `.env` file:**
```bash
# ============================================
# SHARED CONFIGURATION
# ============================================

# Server Configuration
PORT=8001                              # Port for webhook servers (both platforms)

# Paths
REPO_PATH=/home/joshnewton/Development/clarify-your-compass
CLAUDE_CODE_PATH=/home/joshnewton/.claude/local/claude
LOG_DIR=./logs
WORKTREE_BASE_DIR=/tmp/claude-automation

# API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...    # For Claude Code SDK

# ============================================
# GITHUB CONFIGURATION (EXISTING)
# ============================================

# GitHub Authentication (Optional)
# If not set, uses 'gh auth login' credentials
GITHUB_PAT=

# GitHub-specific settings
E2B_API_KEY=                           # Agent Cloud Sandbox (optional)
CLOUDFLARED_TUNNEL_TOKEN=              # For exposing webhook (optional)
CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=true

# ============================================
# CLICKUP CONFIGURATION (NEW)
# ============================================

# ClickUp Authentication (Required for ClickUp)
CLICKUP_API_KEY=pk_10205919_...
CLICKUP_WEBHOOK_SECRET=your-webhook-secret

# ClickUp-specific settings
CLICKUP_LIST_ID=                       # Optional: filter tasks to this list
CLICKUP_TEST_TASK_ID=                  # Optional: for health check testing

# ============================================
# OPTIONAL: SSL CONFIGURATION
# ============================================

SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem
```

### 7.2 Webhook Configuration

**GitHub Webhook (Existing):**
```
URL: https://your-domain.com/gh-webhook
Events: Issues, Issue comments
Secret: (not used, uses gh auth)
```

**ClickUp Webhook (New):**
```
URL: https://your-domain.com/clickup-webhook
Events:
  - Task created
  - Task comment posted
Secret: Value of CLICKUP_WEBHOOK_SECRET
```

### 7.3 Running Multiple Webhooks

**Option A: Same Server, Different Endpoints**
```bash
# Both endpoints on same server
uv run adws/trigger_webhook.py  # Handles both /gh-webhook and /clickup-webhook
```

**Option B: Separate Servers**
```bash
# Terminal 1: GitHub webhooks
PORT=8001 uv run adws/trigger_webhook.py

# Terminal 2: ClickUp webhooks
PORT=8002 uv run adws/trigger_clickup_webhook.py
```

**Recommendation:** Option A (same server) for simplicity

---

## 8. Migration & Deployment

### 8.1 Deployment Steps

**Step 1: Install Dependencies**
```bash
cd /home/joshnewton/Development/clickup-automation

# Dependencies installed automatically by uv
uv run adws/trigger_clickup_webhook.py --help
```

**Step 2: Configure Environment**
```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env and add:
# - CLICKUP_API_KEY
# - CLICKUP_WEBHOOK_SECRET
nano .env
```

**Step 3: Health Check**
```bash
# Check ClickUp configuration
uv run adws/health_check.py --platform clickup

# Check both platforms
uv run adws/health_check.py
```

**Step 4: Start Webhook Server**
```bash
# Start server (handles both platforms)
uv run adws/trigger_clickup_webhook.py
```

**Step 5: Configure ClickUp Webhook**
```
1. Go to ClickUp Space/List settings
2. Add webhook:
   - URL: https://your-domain.com/clickup-webhook
   - Secret: (your CLICKUP_WEBHOOK_SECRET)
   - Events: Task created, Task comment posted
3. Test webhook from ClickUp
```

**Step 6: Test End-to-End**
```bash
# Create test task in ClickUp
# Add comment "adw"
# Monitor logs: tail -f logs/*.log
# Verify task gets updated
```

### 8.2 Rollback Plan

**If ClickUp integration has issues:**

1. **Disable ClickUp webhook in ClickUp settings**
   - Prevents new ClickUp tasks from triggering

2. **Existing GitHub webhooks unaffected**
   - GitHub workflow continues normally

3. **Revert code changes** (if needed)
   ```bash
   git revert <commit-hash>
   ```

**No Risk to Existing GitHub Functionality:**
- GitHub code unchanged
- Separate webhook endpoint
- Separate orchestrator entry point

---

## 9. Documentation Updates

### 9.1 README Updates

**Add Section: "Platform Support"**
```markdown
## Platform Support

This ADW system supports automation from multiple platforms:

### GitHub Issues
Trigger automation via:
- New issue created
- Comment with "adw" on existing issue

Setup: See [GitHub Setup](#github-setup)

### ClickUp Tasks
Trigger automation via:
- New task created in configured list
- Comment with "adw" on existing task

Setup: See [ClickUp Setup](#clickup-setup)
```

**Add Section: "ClickUp Setup"**
```markdown
## ClickUp Setup

### Prerequisites
1. ClickUp account with API access
2. Workspace with admin permissions

### Configuration

1. **Get ClickUp API Key:**
   ```
   ClickUp → Settings → Apps → Generate API Token
   ```

2. **Configure Environment:**
   ```bash
   # Add to .env
   CLICKUP_API_KEY=pk_your_key_here
   CLICKUP_WEBHOOK_SECRET=your-secret-here
   CLICKUP_LIST_ID=optional-list-id
   ```

3. **Start Webhook Server:**
   ```bash
   uv run adws/trigger_clickup_webhook.py
   ```

4. **Configure ClickUp Webhook:**
   ```
   Space/List → Settings → Webhooks

   URL: https://your-domain.com/clickup-webhook
   Secret: (your CLICKUP_WEBHOOK_SECRET)
   Events:
     ☑ Task created
     ☑ Task comment posted
   ```

5. **Test:**
   - Create task in ClickUp
   - Add comment "adw"
   - Check logs: `tail -f logs/*.log`
```

### 9.2 New Documentation Files

**`docs/clickup-integration.md`**
- Detailed ClickUp setup guide
- Webhook configuration
- Custom field setup
- Troubleshooting

**`docs/platform-comparison.md`**
- Feature comparison: GitHub vs ClickUp
- When to use which platform
- Limitations of each

**`docs/architecture.md`**
- System architecture
- Platform adapter pattern
- Module relationships

---

## 10. Risk Assessment & Mitigation

### 10.1 Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Breaking GitHub functionality | **High** | **Low** | No changes to github.py, separate endpoints, comprehensive regression testing |
| ClickUp API rate limits | Medium | Medium | Implement rate limiting, exponential backoff |
| MCP ClickUp tools unavailable | Medium | Low | Fallback to direct API calls |
| Webhook signature mismatch | Low | Medium | Clear documentation, test endpoint |
| Platform confusion in logs | Low | Medium | Include platform name in all log messages |
| Custom field not found | Low | High | Graceful fallback, clear error messages |

### 10.2 Mitigation Strategies

**GitHub Functionality Protection:**
- No modifications to `github.py`
- Separate webhook endpoint (`/clickup-webhook` vs `/gh-webhook`)
- Backward-compatible CLI arguments in `adw_plan_build.py`
- Comprehensive regression test suite
- Platform adapter isolates changes

**ClickUp API Reliability:**
- Implement retry logic with exponential backoff
- Cache task data to reduce API calls
- Fallback to direct API if MCP unavailable
- Monitor API usage and set alerts

**Error Handling:**
- Graceful degradation (comment fails → log warning, continue)
- Platform-specific error messages
- Include platform name in all errors
- Detailed logging at each stage

---

## 11. Success Metrics

### 11.1 Functional Metrics
- ✅ ClickUp webhook triggers successfully (>95% success rate)
- ✅ GitHub workflow continues unchanged (100% backward compatibility)
- ✅ Both platforms can run concurrently
- ✅ Task/issue comments appear correctly
- ✅ Custom fields update successfully
- ✅ PRs created for both platforms

### 11.2 Quality Metrics
- ✅ Code coverage >80% for new modules
- ✅ All existing tests pass
- ✅ Health check passes for both platforms
- ✅ Response time <10 seconds for webhook
- ✅ Error rate <5%

### 11.3 Operational Metrics
- ✅ Deployment completes without rollback
- ✅ Zero downtime for GitHub webhooks
- ✅ Documentation complete and accurate
- ✅ Team trained on new features

---

## 12. Future Enhancements

### 12.1 Short-term (Next 3 months)
- Add support for ClickUp subtasks
- Implement ClickUp-specific slash commands
- Add webhook event filtering UI
- Improve error recovery

### 12.2 Long-term (6-12 months)
- Support for other platforms (Jira, Linear, etc.)
- Web dashboard for monitoring workflows
- Advanced workflow customization
- Multi-repo support
- Slack notifications

---

## 13. Appendices

### 13.1 File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `adws/clickup.py` | **NEW** | ClickUp API operations |
| `adws/trigger_clickup_webhook.py` | **NEW** | ClickUp webhook server |
| `adws/platform_adapter.py` | **NEW** | Platform abstraction layer |
| `adws/data_types.py` | **MODIFIED** | Add ClickUp models |
| `adws/adw_plan_build.py` | **MODIFIED** | Add platform support |
| `adws/health_check.py` | **MODIFIED** | Add ClickUp checks |
| `adws/github.py` | **UNCHANGED** | No modifications |
| `adws/trigger_webhook.py` | **UNCHANGED** | No modifications |
| `adws/agent.py` | **UNCHANGED** | No modifications |
| `.claude/commands/*.md` | **OPTIONAL** | Minor terminology updates |
| `.env.example` | **MODIFIED** | Add ClickUp variables |
| `README.md` | **MODIFIED** | Add ClickUp documentation |

### 13.2 Estimated Effort

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| Phase 1: Foundation | Core modules, adapters | 4-5 hours |
| Phase 2: Webhooks | Webhook server, testing | 2-3 hours |
| Phase 3: Orchestrator | Update main workflow | 4-5 hours |
| Phase 4: Testing | Health checks, E2E tests | 3-4 hours |
| Phase 5: Deploy | Polish, documentation | 2-3 hours |
| **Total** | | **15-20 hours** |

### 13.3 Dependencies

**Python Packages:**
- `fastapi` - Webhook server
- `uvicorn` - ASGI server
- `pydantic` - Data validation
- `python-dotenv` - Environment variables

**External Services:**
- ClickUp API
- GitHub API (existing)
- Claude Code CLI
- ClickUp MCP Server

**System Requirements:**
- Python 3.8+
- uv package manager
- git
- gh CLI (for GitHub)

---

## 14. Approval & Sign-off

**Specification Status:** ✅ Ready for Implementation

**Reviewed By:** [To be filled]

**Approved By:** [To be filled]

**Implementation Start Date:** 2025-10-13

**Target Completion Date:** [To be determined based on effort estimate]

---

**End of Specification**
