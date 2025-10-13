#!/usr/bin/env -S uv run
# /// script
# dependencies = ["python-dotenv", "pydantic"]
# ///

"""
ClickUp Operations Module - AI Developer Workflow (ADW)

This module contains all ClickUp-related operations including:
- Task fetching and manipulation
- Comment posting
- Status updates
- Custom field management

Parallel to github.py for ClickUp platform.
"""

import subprocess
import sys
import os
import json
from typing import Dict, List, Optional, Any
from data_types import ClickUpTask, ClickUpComment


class ClickUpAPIError(Exception):
    """Exception raised for ClickUp API errors."""
    pass


class TaskNotFoundError(Exception):
    """Exception raised when a task is not found."""
    pass


def get_clickup_env() -> Optional[dict]:
    """
    Get environment with ClickUp API key configured.
    Similar to github.get_github_env()

    Returns:
        Optional[dict]: Environment dict with CLICKUP_API_KEY, or None
    """
    clickup_api_key = os.getenv("CLICKUP_API_KEY")
    if not clickup_api_key:
        return None

    # Return minimal env with ClickUp API key
    env = {
        "CLICKUP_API_KEY": clickup_api_key,
        "PATH": os.environ.get("PATH", ""),
    }
    return env


def get_task(task_id: str) -> ClickUpTask:
    """
    Fetch ClickUp task details using MCP tools.
    Parallel to github.fetch_issue()

    Args:
        task_id: ClickUp task ID (e.g., "abc123")

    Returns:
        ClickUpTask: Typed Pydantic model with task details

    Raises:
        TaskNotFoundError: If task doesn't exist
        ClickUpAPIError: If API call fails
    """
    try:
        # Note: This will be called by the orchestrator which has access to MCP tools
        # For now, we'll use a subprocess approach to call the MCP tool via Claude Code
        # In actual runtime, the MCP tools will be available directly

        # Check if API key is configured
        api_key = os.getenv("CLICKUP_API_KEY")
        if not api_key:
            raise ClickUpAPIError("CLICKUP_API_KEY not set in environment")

        # Import the MCP function directly if available
        # This will work when running within Claude Code context
        try:
            from mcp__clickup__get_task import get_task as mcp_get_task
            task_data = mcp_get_task(task_id)
            return ClickUpTask(**task_data)
        except ImportError:
            # Fallback: Direct API call using https
            import https
            url = f"https://api.clickup.com/api/v2/task/{task_id}"

            # This is a placeholder - in practice, MCP tools will be used
            raise ClickUpAPIError(
                "MCP ClickUp tools not available. "
                "This function should be called from Claude Code with MCP enabled."
            )

    except Exception as e:
        if "not found" in str(e).lower():
            raise TaskNotFoundError(f"Task {task_id} not found")
        else:
            raise ClickUpAPIError(f"Failed to fetch task {task_id}: {str(e)}")


def add_task_comment(task_id: str, comment: str) -> None:
    """
    Post a comment to a ClickUp task.
    Parallel to github.make_issue_comment()

    Args:
        task_id: ClickUp task ID
        comment: Comment text (supports markdown)

    Raises:
        ClickUpAPIError: If API call fails
    """
    try:
        # Check if API key is configured
        api_key = os.getenv("CLICKUP_API_KEY")
        if not api_key:
            raise ClickUpAPIError("CLICKUP_API_KEY not set in environment")

        # Import the MCP function directly if available
        try:
            from mcp__clickup__add_comment import add_comment as mcp_add_comment
            mcp_add_comment(task_id, comment)
            print(f"Successfully posted comment to task #{task_id}")
        except ImportError:
            # Fallback
            raise ClickUpAPIError(
                "MCP ClickUp tools not available. "
                "This function should be called from Claude Code with MCP enabled."
            )

    except Exception as e:
        print(f"Error posting comment to task {task_id}: {e}", file=sys.stderr)
        raise ClickUpAPIError(f"Failed to add comment: {str(e)}")


def update_task_status(task_id: str, status: str) -> None:
    """
    Update ClickUp task status.
    Parallel to github.mark_issue_in_progress()

    Args:
        task_id: ClickUp task ID
        status: Status name (e.g., "in progress", "Ready for Review (DEV)")

    Raises:
        ClickUpAPIError: If API call fails
    """
    try:
        # Check if API key is configured
        api_key = os.getenv("CLICKUP_API_KEY")
        if not api_key:
            raise ClickUpAPIError("CLICKUP_API_KEY not set in environment")

        # Import the MCP function directly if available
        try:
            from mcp__clickup__update_task_status import update_task_status as mcp_update_status
            mcp_update_status(task_id, status)
            print(f"Successfully updated task #{task_id} status to: {status}")
        except ImportError:
            # Fallback
            raise ClickUpAPIError(
                "MCP ClickUp tools not available. "
                "This function should be called from Claude Code with MCP enabled."
            )

    except Exception as e:
        print(f"Error updating task {task_id} status: {e}", file=sys.stderr)
        raise ClickUpAPIError(f"Failed to update status: {str(e)}")


def set_task_custom_field(task_id: str, list_id: str, field_name: str, value: Any) -> None:
    """
    Set custom field value on ClickUp task.

    Args:
        task_id: ClickUp task ID
        list_id: ClickUp list ID (needed for field lookup)
        field_name: Custom field name (e.g., "GitHub Branch")
        value: Field value

    Raises:
        ClickUpAPIError: If API call fails
    """
    try:
        # Check if API key is configured
        api_key = os.getenv("CLICKUP_API_KEY")
        if not api_key:
            raise ClickUpAPIError("CLICKUP_API_KEY not set in environment")

        # Import the MCP function directly if available
        try:
            from mcp__clickup__set_custom_field_value_by_name import (
                set_custom_field_value_by_name as mcp_set_field
            )
            mcp_set_field(task_id, list_id, field_name, value)
            print(f"Successfully set custom field '{field_name}' on task #{task_id}")
        except ImportError:
            # Fallback
            raise ClickUpAPIError(
                "MCP ClickUp tools not available. "
                "This function should be called from Claude Code with MCP enabled."
            )

    except Exception as e:
        print(f"Error setting custom field on task {task_id}: {e}", file=sys.stderr)
        raise ClickUpAPIError(f"Failed to set custom field: {str(e)}")


def get_list_id_from_task(task_id: str) -> str:
    """
    Helper to extract list_id from task (needed for custom fields).

    Args:
        task_id: ClickUp task ID

    Returns:
        str: List ID containing the task

    Raises:
        ClickUpAPIError: If task fetch fails
    """
    try:
        task = get_task(task_id)
        # ClickUpTask model has a 'list' field which is a Dict containing 'id'
        list_info = task.list
        if isinstance(list_info, dict) and 'id' in list_info:
            return list_info['id']
        else:
            raise ClickUpAPIError(f"Could not extract list_id from task {task_id}")
    except Exception as e:
        raise ClickUpAPIError(f"Failed to get list_id: {str(e)}")


def extract_task_type(task: ClickUpTask) -> str:
    """
    Determine task type from tags or custom fields.

    Args:
        task: ClickUpTask instance

    Returns:
        str: Task type - "feature", "bug", "chore", or "update"

    Logic:
        1. Check for task tags (bug, feature, chore)
        2. Check custom field "Type"
        3. Analyze task name/description (fallback)
    """
    # Check tags first
    for tag in task.tags:
        tag_name = tag.name.lower()
        if 'bug' in tag_name or 'fix' in tag_name:
            return 'bug'
        elif 'feature' in tag_name:
            return 'feature'
        elif 'chore' in tag_name:
            return 'chore'
        elif 'update' in tag_name or 'enhance' in tag_name:
            return 'update'

    # Check custom fields
    for field in task.custom_fields:
        if field.name.lower() == 'type' and field.value:
            value = str(field.value).lower()
            if 'bug' in value or 'fix' in value:
                return 'bug'
            elif 'feature' in value:
                return 'feature'
            elif 'chore' in value:
                return 'chore'
            elif 'update' in value or 'enhance' in value:
                return 'update'

    # Fallback: analyze task name and description
    text = f"{task.name} {task.description or task.text_content or ''}".lower()

    if any(keyword in text for keyword in ['fix', 'bug', 'error', 'broken']):
        return 'bug'
    elif any(keyword in text for keyword in ['chore', 'refactor', 'cleanup', 'maintenance']):
        return 'chore'
    elif any(keyword in text for keyword in ['update', 'enhance', 'improve', 'optimize']):
        return 'update'
    else:
        # Default to feature
        return 'feature'
