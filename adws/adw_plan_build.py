#!/usr/bin/env -S uv run
# /// script
# dependencies = ["python-dotenv", "pydantic", "requests"]
# ///

"""
ADW Plan & Build - Main workflow orchestrator.

Supports both GitHub issues and ClickUp tasks via platform adapter.

Usage:
    # GitHub (existing - backward compatible)
    uv run adw_plan_build.py <issue_number> <adw_id>
    uv run adw_plan_build.py --platform github --issue 123 --adw-id xyz

    # ClickUp (new)
    uv run adw_plan_build.py --platform clickup --task-id abc123 --adw-id xyz

Workflow:
1. Fetch work item (issue or task) details
2. Create feature branch
3. Plan Agent: Generate implementation plan
4. Build Agent: Implement the solution
5. Create PR with full context

Environment Requirements:
- ANTHROPIC_API_KEY: Anthropic API key
- CLAUDE_CODE_PATH: Path to Claude CLI
- GITHUB_PAT: (Optional) GitHub Personal Access Token
- CLICKUP_API_KEY: (Optional) ClickUp API key (required for ClickUp platform)
"""

import argparse
import subprocess
import sys
import os
import logging
from typing import Tuple, Optional, Union
from dotenv import load_dotenv
from data_types import (
    AgentTemplateRequest,
    AgentPromptResponse,
    IssueClassSlashCommand,
    WorkItem,
)
from agent import execute_template
from utils import make_adw_id, setup_logger

# Agent name constants
AGENT_PLANNER = "sdlc_planner"
AGENT_IMPLEMENTOR = "sdlc_implementor"
AGENT_CLASSIFIER = "issue_classifier"
AGENT_PLAN_FINDER = "plan_finder"
AGENT_BRANCH_GENERATOR = "branch_generator"
AGENT_PR_CREATOR = "pr_creator"


def check_env_vars(logger: Optional[logging.Logger] = None) -> None:
    """Check that all required environment variables are set."""
    required_vars = [
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_PATH",
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        error_msg = "Error: Missing required environment variables:"
        if logger:
            logger.error(error_msg)
            for var in missing_vars:
                logger.error(f"  - {var}")
        else:
            print(error_msg, file=sys.stderr)
            for var in missing_vars:
                print(f"  - {var}", file=sys.stderr)
        sys.exit(1)


def parse_args():
    """Parse command line arguments with backward compatibility."""
    parser = argparse.ArgumentParser(
        description="ADW Plan & Build Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Platform selection
    parser.add_argument(
        "--platform",
        choices=["github", "clickup"],
        default=None,
        help="Platform to use (github or clickup)",
    )

    # Work item identifier
    parser.add_argument("--issue", type=str, help="GitHub issue number")
    parser.add_argument("--task-id", type=str, help="ClickUp task ID")

    # ADW workflow ID
    parser.add_argument("--adw-id", type=str, help="ADW workflow ID")

    # Backward compatibility: positional args
    parser.add_argument(
        "legacy_issue", nargs="?", help="Legacy: issue number (positional arg 1)"
    )
    parser.add_argument(
        "legacy_adw_id", nargs="?", help="Legacy: ADW ID (positional arg 2)"
    )

    args = parser.parse_args()

    # Handle legacy positional arguments
    if args.legacy_issue:
        args.platform = "github"
        args.issue = args.legacy_issue
        if args.legacy_adw_id:
            args.adw_id = args.legacy_adw_id

    # Default to GitHub if no platform specified
    if not args.platform:
        args.platform = "github"

    # Validate arguments
    if args.platform == "github" and not args.issue:
        parser.error("--issue is required for --platform github")
    if args.platform == "clickup" and not args.task_id:
        parser.error("--task-id is required for --platform clickup")

    # Generate ADW ID if not provided
    if not args.adw_id:
        args.adw_id = make_adw_id()

    return args


def format_item_message(
    adw_id: str, agent_name: str, message: str, session_id: Optional[str] = None
) -> str:
    """Format a message for item comments with ADW tracking."""
    if session_id:
        return f"{adw_id}_{agent_name}_{session_id}: {message}"
    return f"{adw_id}_{agent_name}: {message}"


def classify_work_item(
    work_item: WorkItem, adw_id: str, logger: logging.Logger
) -> Tuple[Optional[IssueClassSlashCommand], Optional[str]]:
    """Classify work item and return appropriate slash command.
    Returns (command, error_message) tuple."""
    # Use raw_data for full context
    item_json = work_item.model_dump_json(indent=2)

    item_template_request = AgentTemplateRequest(
        agent_name=AGENT_CLASSIFIER,
        slash_command="/classify_issue",
        args=[item_json],
        adw_id=adw_id,
        model="sonnet",
    )

    logger.debug(
        f"item_template_request: {item_template_request.model_dump_json(indent=2, by_alias=True)}"
    )

    item_response = execute_template(item_template_request)

    logger.debug(
        f"item_response: {item_response.model_dump_json(indent=2, by_alias=True)}"
    )

    if not item_response.success:
        return None, item_response.output

    item_command = item_response.output.strip()

    if item_command == "0":
        return None, f"No command selected: {item_response.output}"

    if item_command not in ["/chore", "/bug", "/feature"]:
        return None, f"Invalid command selected: {item_response.output}"

    return item_command, None  # type: ignore


def build_plan(
    work_item: WorkItem, command: str, adw_id: str, logger: logging.Logger
) -> AgentPromptResponse:
    """Build implementation plan for the work item using the specified command."""
    item_plan_template_request = AgentTemplateRequest(
        agent_name=AGENT_PLANNER,
        slash_command=command,
        args=[work_item.title + ": " + work_item.description],
        adw_id=adw_id,
        model="sonnet",
    )

    logger.debug(
        f"item_plan_template_request: {item_plan_template_request.model_dump_json(indent=2, by_alias=True)}"
    )

    item_plan_response = execute_template(item_plan_template_request)

    logger.debug(
        f"item_plan_response: {item_plan_response.model_dump_json(indent=2, by_alias=True)}"
    )

    return item_plan_response


def get_plan_file(
    plan_output: str, adw_id: str, logger: logging.Logger
) -> Tuple[Optional[str], Optional[str]]:
    """Get the path to the plan file that was just created.
    Returns (file_path, error_message) tuple."""
    request = AgentTemplateRequest(
        agent_name=AGENT_PLAN_FINDER,
        slash_command="/find_plan_file",
        args=[plan_output],
        adw_id=adw_id,
        model="sonnet",
    )

    response = execute_template(request)

    if not response.success:
        return None, response.output

    # Clean up the response - get just the file path
    file_path = response.output.strip()

    # Validate it looks like a file path
    if file_path and file_path != "0" and "/" in file_path:
        return file_path, None
    elif file_path == "0":
        return None, "No plan file found in output"
    else:
        return None, f"Invalid file path response: {file_path}"


def implement_plan(
    plan_file: str, adw_id: str, logger: logging.Logger
) -> AgentPromptResponse:
    """Implement the plan using the /implement command."""
    implement_template_request = AgentTemplateRequest(
        agent_name=AGENT_IMPLEMENTOR,
        slash_command="/implement",
        args=[plan_file],
        adw_id=adw_id,
        model="sonnet",
    )

    logger.debug(
        f"implement_template_request: {implement_template_request.model_dump_json(indent=2, by_alias=True)}"
    )

    implement_response = execute_template(implement_template_request)

    logger.debug(
        f"implement_response: {implement_response.model_dump_json(indent=2, by_alias=True)}"
    )

    return implement_response


def git_branch(
    work_item: WorkItem,
    item_class: IssueClassSlashCommand,
    adw_id: str,
    item_id: str,
    logger: logging.Logger,
) -> Tuple[Optional[str], Optional[str]]:
    """Generate and create a git branch for the work item.
    Returns (branch_name, error_message) tuple."""
    # Remove the leading slash from item_class for the branch name
    item_type = item_class.replace("/", "")

    request = AgentTemplateRequest(
        agent_name=AGENT_BRANCH_GENERATOR,
        slash_command="/generate_branch_name",
        args=[item_type, item_id, work_item.model_dump_json()],
        adw_id=adw_id,
        model="sonnet",
    )

    response = execute_template(request)

    if not response.success:
        return None, response.output

    branch_name = response.output.strip()
    logger.info(f"Created branch: {branch_name}")
    return branch_name, None


def git_commit(
    agent_name: str,
    work_item: WorkItem,
    item_class: IssueClassSlashCommand,
    item_id: str,
    adw_id: str,
    logger: logging.Logger,
) -> Tuple[Optional[str], Optional[str]]:
    """Create a git commit with a properly formatted message.
    Returns (commit_message, error_message) tuple."""
    # Remove the leading slash from item_class
    item_type = item_class.replace("/", "")

    # Create unique committer agent name by suffixing '_committer'
    unique_agent_name = f"{agent_name}_committer"

    request = AgentTemplateRequest(
        agent_name=unique_agent_name,
        slash_command="/commit",
        args=[agent_name, item_type, work_item.model_dump_json()],
        adw_id=adw_id,
        model="sonnet",
    )

    response = execute_template(request)

    if not response.success:
        return None, response.output

    commit_message = response.output.strip()
    logger.info(f"Created commit: {commit_message}")
    return commit_message, None


def pull_request(
    branch_name: str,
    work_item: WorkItem,
    plan_file: str,
    item_id: str,
    platform: str,
    adw_id: str,
    logger: logging.Logger,
) -> Tuple[Optional[str], Optional[str]]:
    """Create a pull request for the implemented changes.
    Returns (pr_url, error_message) tuple."""
    # Include platform in PR context
    item_context = f"Platform: {platform}\nItem ID: {item_id}\n\n{work_item.model_dump_json()}"

    request = AgentTemplateRequest(
        agent_name=AGENT_PR_CREATOR,
        slash_command="/pull_request",
        args=[branch_name, item_context, plan_file, adw_id],
        adw_id=adw_id,
        model="sonnet",
    )

    response = execute_template(request)

    if not response.success:
        return None, response.output

    pr_url = response.output.strip()
    logger.info(f"Created pull request: {pr_url}")
    return pr_url, None


def check_error(
    error_or_response: Union[Optional[str], AgentPromptResponse],
    item_id: str,
    adw_id: str,
    agent_name: str,
    error_prefix: str,
    logger: logging.Logger,
    adapter,
) -> None:
    """Check for errors and handle them uniformly.

    Args:
        error_or_response: Either an error string or an AgentPromptResponse
        item_id: Work item ID (issue number or task ID)
        adw_id: ADW workflow ID
        agent_name: Name of the agent
        error_prefix: Prefix for error message
        logger: Logger instance
        adapter: Platform adapter for posting comments
    """
    error = None

    # Handle AgentPromptResponse
    if isinstance(error_or_response, AgentPromptResponse):
        if not error_or_response.success:
            error = error_or_response.output
    else:
        # Handle string error
        error = error_or_response

    if error:
        logger.error(f"{error_prefix}: {error}")
        try:
            adapter.add_comment(
                item_id, format_item_message(adw_id, agent_name, f"❌ {error_prefix}: {error}")
            )
        except Exception as e:
            logger.error(f"Failed to post error comment: {e}")
        sys.exit(1)


def main():
    """Main entry point."""
    # Load environment variables
    load_dotenv()

    # Parse arguments
    args = parse_args()

    # Set up logger with ADW ID
    logger = setup_logger(args.adw_id, "adw_plan_build")
    logger.info(f"ADW ID: {args.adw_id}")
    logger.info(f"Platform: {args.platform}")

    # Validate environment
    check_env_vars(logger)

    # Create platform adapter
    from platform_adapter import create_adapter

    if args.platform == "github":
        item_id = args.issue
        try:
            adapter = create_adapter("github")
        except Exception as e:
            logger.error(f"Error creating GitHub adapter: {e}")
            sys.exit(1)
    else:  # clickup
        item_id = args.task_id
        list_id = os.getenv("CLICKUP_LIST_ID")  # Optional
        try:
            adapter = create_adapter("clickup", list_id=list_id)
        except Exception as e:
            logger.error(f"Error creating ClickUp adapter: {e}")
            sys.exit(1)

    logger.info(f"Using {adapter.get_platform_name()} adapter for item {item_id}")

    # Fetch work item (issue or task)
    try:
        work_item = adapter.get_work_item(item_id)
        logger.info(f"Fetched work item: {work_item.title}")
    except Exception as e:
        logger.error(f"Error fetching work item: {e}")
        sys.exit(1)

    # Post starting comment
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, "ops", "✅ Starting ADW workflow")
        )
    except Exception as e:
        logger.warning(f"Failed to post starting comment: {e}")

    # Update status to in progress
    try:
        adapter.update_status(item_id, "in progress")
    except Exception as e:
        logger.warning(f"Failed to update status: {e}")

    # === STAGE 1: Classify work item ===
    logger.info("\n=== Stage 1: Classifying work item ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_CLASSIFIER, "✅ Analyzing work item type")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    item_command: IssueClassSlashCommand
    item_command, error = classify_work_item(work_item, args.adw_id, logger)

    check_error(error, item_id, args.adw_id, "ops", "Error classifying item", logger, adapter)

    logger.info(f"item_command: {item_command}")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, "ops", f"✅ Item classified as: {item_command}")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    # === STAGE 2: Generate branch name ===
    logger.info("\n=== Stage 2: Generating branch name ===")
    branch_name, error = git_branch(work_item, item_command, args.adw_id, item_id, logger)

    check_error(error, item_id, args.adw_id, "ops", "Error creating branch", logger, adapter)

    logger.info(f"Working on branch: {branch_name}")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, "ops", f"✅ Working on branch: {branch_name}")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    # === STAGE 3: Build implementation plan ===
    logger.info("\n=== Stage 3: Building implementation plan ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_PLANNER, "✅ Building implementation plan")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    item_plan_response: AgentPromptResponse = build_plan(work_item, item_command, args.adw_id, logger)

    check_error(
        item_plan_response, item_id, args.adw_id, AGENT_PLANNER, "Error building plan", logger, adapter
    )

    logger.debug(f"item_plan_response.output: {item_plan_response.output}")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_PLANNER, "✅ Implementation plan created")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    # === STAGE 4: Find plan file ===
    logger.info("\n=== Stage 4: Finding plan file ===")
    plan_file_path, error = get_plan_file(item_plan_response.output, args.adw_id, logger)

    check_error(error, item_id, args.adw_id, "ops", "Error finding plan file", logger, adapter)

    logger.info(f"plan_file_path: {plan_file_path}")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, "ops", f"✅ Plan file created: {plan_file_path}")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    # === STAGE 5: Commit the plan ===
    logger.info("\n=== Stage 5: Committing plan ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_PLANNER, "✅ Committing plan")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    commit_msg, error = git_commit(AGENT_PLANNER, work_item, item_command, item_id, args.adw_id, logger)

    check_error(error, item_id, args.adw_id, AGENT_PLANNER, "Error committing plan", logger, adapter)

    # === STAGE 6: Implement the plan ===
    logger.info("\n=== Stage 6: Implementing solution ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_IMPLEMENTOR, "✅ Implementing solution")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    implement_response: AgentPromptResponse = implement_plan(plan_file_path, args.adw_id, logger)

    check_error(
        implement_response,
        item_id,
        args.adw_id,
        AGENT_IMPLEMENTOR,
        "Error implementing solution",
        logger,
        adapter,
    )

    logger.debug(f"implement_response.output: {implement_response.output}")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_IMPLEMENTOR, "✅ Solution implemented")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    # === STAGE 7: Commit the implementation ===
    logger.info("\n=== Stage 7: Committing implementation ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, AGENT_IMPLEMENTOR, "✅ Committing implementation")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    commit_msg, error = git_commit(
        AGENT_IMPLEMENTOR, work_item, item_command, item_id, args.adw_id, logger
    )

    check_error(
        error, item_id, args.adw_id, AGENT_IMPLEMENTOR, "Error committing implementation", logger, adapter
    )

    # === STAGE 8: Create pull request ===
    logger.info("\n=== Stage 8: Creating pull request ===")
    try:
        adapter.add_comment(
            item_id, format_item_message(args.adw_id, "ops", "✅ Creating pull request")
        )
    except Exception as e:
        logger.warning(f"Failed to post comment: {e}")

    pr_url, error = pull_request(
        branch_name, work_item, plan_file_path, item_id, args.platform, args.adw_id, logger
    )

    check_error(error, item_id, args.adw_id, "ops", "Error creating pull request", logger, adapter)

    logger.info(f"\nPull request created: {pr_url}")

    # === STAGE 9: Update work item with PR details ===
    logger.info("\n=== Stage 9: Updating work item ===")

    # Set custom fields (if supported)
    try:
        adapter.set_custom_field(item_id, "GitHub Branch", branch_name)
        adapter.set_custom_field(item_id, "GitHub Pull Request URL", pr_url)
        logger.info("✅ Custom fields updated")
    except Exception as e:
        logger.warning(f"Could not set custom fields: {e}")

    # Update status
    try:
        adapter.update_status(item_id, "Ready for Review (DEV)")
        logger.info("✅ Status updated to 'Ready for Review (DEV)'")
    except Exception as e:
        logger.warning(f"Could not update status: {e}")

    # Final comment
    try:
        adapter.add_comment(
            item_id,
            format_item_message(
                args.adw_id,
                "ops",
                f"✅ Automation complete!\n\n"
                f"📦 Pull Request: {pr_url}\n"
                f"🌿 Branch: `{branch_name}`\n\n"
                f"Ready for review!",
            ),
        )
    except Exception as e:
        logger.warning(f"Failed to post final comment: {e}")

    logger.info(f"ADW workflow completed successfully for {args.platform} item #{item_id}")


if __name__ == "__main__":
    main()
