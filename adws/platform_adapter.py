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
from typing import Dict, Optional, Any
from data_types import WorkItem
import os


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
    def set_custom_field(self, item_id: str, field_name: str, value: Any) -> None:
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
            raw_data=github_issue.dict(),
        )

    def add_comment(self, item_id: str, comment: str) -> None:
        """Add comment to GitHub issue."""
        from github import make_issue_comment

        make_issue_comment(item_id, comment)

    def update_status(self, item_id: str, status: str) -> None:
        """Update GitHub issue status (add label, assign)."""
        from github import mark_issue_in_progress

        mark_issue_in_progress(item_id)

    def set_custom_field(self, item_id: str, field_name: str, value: Any) -> None:
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
        status_str = (
            clickup_task.status.status
            if hasattr(clickup_task.status, "status")
            else str(clickup_task.status)
        )

        return WorkItem(
            id=clickup_task.id,
            title=clickup_task.name,
            description=clickup_task.description or clickup_task.text_content or "",
            status=status_str,
            platform="clickup",
            raw_data=clickup_task.dict(),
        )

    def add_comment(self, item_id: str, comment: str) -> None:
        """Add comment to ClickUp task."""
        from clickup import add_task_comment

        add_task_comment(item_id, comment)

    def update_status(self, item_id: str, status: str) -> None:
        """Update ClickUp task status."""
        from clickup import update_task_status

        update_task_status(item_id, status)

    def set_custom_field(self, item_id: str, field_name: str, value: Any) -> None:
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
