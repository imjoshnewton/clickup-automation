#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "python-dotenv",
#     "pydantic",
# ]
# ///

"""
Health Check Script for ADW System

Usage:
uv run adws/health_check.py [--platform {github,clickup,both}] [issue_number]

This script performs comprehensive health checks:
1. Validates all required environment variables
2. Checks git repository configuration (GitHub) or API access (ClickUp)
3. Tests Claude Code CLI functionality
4. Returns structured results

Options:
--platform {github,clickup,both}  Platform to check (default: both)
issue_number                      Optional GitHub issue number to post results to
"""

import os
import sys
import json
import subprocess
import tempfile
from typing import Dict, List, Optional, Any
from datetime import datetime
from pathlib import Path
import argparse

from dotenv import load_dotenv
from pydantic import BaseModel

# Import platform functions
from github import get_repo_url, extract_repo_path, make_issue_comment
from clickup import get_task, ClickUpAPIError

# Load environment variables
load_dotenv()


class CheckResult(BaseModel):
    """Individual check result."""

    success: bool
    error: Optional[str] = None
    warning: Optional[str] = None
    details: Dict[str, Any] = {}


class HealthCheckResult(BaseModel):
    """Structure for health check results."""

    success: bool
    timestamp: str
    checks: Dict[str, CheckResult]
    warnings: List[str] = []
    errors: List[str] = []


def check_env_vars(platform: str = "both") -> CheckResult:
    """Check required environment variables.

    Args:
        platform: "github", "clickup", or "both"
    """
    # Shared required vars
    required_vars = {
        "ANTHROPIC_API_KEY": "Anthropic API Key for Claude Code",
        "CLAUDE_CODE_PATH": "Path to Claude Code CLI (defaults to 'claude')",
    }

    # GitHub-specific vars
    github_optional = {
        "GITHUB_PAT": "(Optional) GitHub Personal Access Token - only needed if you want ADW to use a different GitHub account than 'gh auth login'",
        "E2B_API_KEY": "(Optional) E2B API Key for sandbox environments",
        "CLOUDFLARED_TUNNEL_TOKEN": "(Optional) Cloudflare tunnel token for webhook exposure",
    }

    # ClickUp-specific vars
    clickup_required = {
        "CLICKUP_API_KEY": "ClickUp API Key for task operations",
        "CLICKUP_WEBHOOK_SECRET": "ClickUp webhook secret for signature verification",
    }

    clickup_optional = {
        "CLICKUP_LIST_ID": "(Optional) ClickUp list ID for filtering tasks",
        "CLICKUP_TEST_TASK_ID": "(Optional) ClickUp test task ID for health checks",
    }

    missing_required = []
    missing_optional = []

    # Check shared required vars
    for var, desc in required_vars.items():
        if not os.getenv(var):
            if var == "CLAUDE_CODE_PATH":
                # This has a default, so not critical
                continue
            missing_required.append(f"{var} ({desc})")

    # Check platform-specific vars
    if platform in ["clickup", "both"]:
        for var, desc in clickup_required.items():
            if not os.getenv(var):
                missing_required.append(f"{var} ({desc})")
        for var, desc in clickup_optional.items():
            if not os.getenv(var):
                missing_optional.append(f"{var} ({desc})")

    if platform in ["github", "both"]:
        for var, desc in github_optional.items():
            if not os.getenv(var):
                missing_optional.append(f"{var} ({desc})")

    success = len(missing_required) == 0

    return CheckResult(
        success=success,
        error="Missing required environment variables" if not success else None,
        details={
            "missing_required": missing_required,
            "missing_optional": missing_optional,
            "claude_code_path": os.getenv("CLAUDE_CODE_PATH", "claude"),
            "platform": platform,
        },
    )


def check_git_repo() -> CheckResult:
    """Check git repository configuration using github module."""
    try:
        # Get repo URL using the github module function
        repo_url = get_repo_url()
        repo_path = extract_repo_path(repo_url)

        # Check if still using disler's repo
        is_disler_repo = "disler" in repo_path.lower()

        return CheckResult(
            success=True,
            warning=(
                "Repository still points to 'disler'. Please update to your own GitHub repository."
                if is_disler_repo
                else None
            ),
            details={
                "repo_url": repo_url,
                "repo_path": repo_path,
                "is_disler_repo": is_disler_repo,
            },
        )
    except ValueError as e:
        return CheckResult(success=False, error=str(e))


def check_claude_code() -> CheckResult:
    """Test Claude Code CLI functionality."""
    claude_path = os.getenv("CLAUDE_CODE_PATH", "claude")

    # First check if Claude Code is installed
    try:
        result = subprocess.run(
            [claude_path, "--version"], capture_output=True, text=True
        )
        if result.returncode != 0:
            return CheckResult(
                success=False,
                error=f"Claude Code CLI not functional at '{claude_path}'",
            )
    except FileNotFoundError:
        return CheckResult(
            success=False,
            error=f"Claude Code CLI not found at '{claude_path}'. Please install or set CLAUDE_CODE_PATH correctly.",
        )

    # Test with a simple prompt
    test_prompt = "What is 2+2? Just respond with the number, nothing else."

    # Prepare environment
    env = os.environ.copy()
    if os.getenv("GITHUB_PAT"):
        env["GH_TOKEN"] = os.getenv("GITHUB_PAT")

    try:
        # Create temporary file for output
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as tmp:
            output_file = tmp.name

        # Run Claude Code
        cmd = [
            claude_path,
            "-p",
            test_prompt,
            "--model",
            "claude-3-5-haiku-20241022",
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]

        with open(output_file, "w") as f:
            result = subprocess.run(
                cmd, stdout=f, stderr=subprocess.PIPE, text=True, env=env, timeout=30
            )

        if result.returncode != 0:
            return CheckResult(
                success=False, error=f"Claude Code test failed: {result.stderr}"
            )

        # Parse output to verify it worked
        claude_responded = False
        response_text = ""

        try:
            with open(output_file, "r") as f:
                for line in f:
                    if line.strip():
                        msg = json.loads(line)
                        if msg.get("type") == "result":
                            claude_responded = True
                            response_text = msg.get("result", "")
                            break
        finally:
            # Clean up temp file
            if os.path.exists(output_file):
                os.unlink(output_file)

        return CheckResult(
            success=claude_responded,
            details={
                "test_passed": "4" in response_text,
                "response": response_text[:100] if response_text else "No response",
            },
        )

    except subprocess.TimeoutExpired:
        return CheckResult(
            success=False, error="Claude Code test timed out after 30 seconds"
        )
    except Exception as e:
        return CheckResult(success=False, error=f"Claude Code test error: {str(e)}")


def check_github_cli() -> CheckResult:
    """Check if GitHub CLI is installed and authenticated."""
    try:
        # Check if gh is installed
        result = subprocess.run(["gh", "--version"], capture_output=True, text=True)
        if result.returncode != 0:
            return CheckResult(success=False, error="GitHub CLI (gh) is not installed")

        # Check authentication status
        env = os.environ.copy()
        if os.getenv("GITHUB_PAT"):
            env["GH_TOKEN"] = os.getenv("GITHUB_PAT")

        result = subprocess.run(
            ["gh", "auth", "status"], capture_output=True, text=True, env=env
        )

        authenticated = result.returncode == 0

        return CheckResult(
            success=authenticated,
            error="GitHub CLI not authenticated" if not authenticated else None,
            details={"installed": True, "authenticated": authenticated},
        )

    except FileNotFoundError:
        return CheckResult(
            success=False,
            error="GitHub CLI (gh) is not installed. Install with: brew install gh",
            details={"installed": False},
        )


def check_clickup_api() -> CheckResult:
    """Check ClickUp API connectivity and configuration."""
    api_key = os.getenv("CLICKUP_API_KEY")
    webhook_secret = os.getenv("CLICKUP_WEBHOOK_SECRET")
    test_task_id = os.getenv("CLICKUP_TEST_TASK_ID")

    if not api_key:
        return CheckResult(
            success=False,
            error="CLICKUP_API_KEY not set in environment",
            details={"api_key_configured": False}
        )

    if not webhook_secret:
        return CheckResult(
            success=False,
            error="CLICKUP_WEBHOOK_SECRET not set in environment",
            details={"api_key_configured": True, "webhook_secret_configured": False}
        )

    # If test task ID is provided, try to fetch it
    if test_task_id:
        try:
            task = get_task(test_task_id)
            return CheckResult(
                success=True,
                details={
                    "api_key_configured": True,
                    "webhook_secret_configured": True,
                    "api_connection": "success",
                    "test_task": {
                        "id": task.id,
                        "name": task.name,
                        "status": task.status.status if hasattr(task.status, "status") else str(task.status)
                    }
                }
            )
        except ClickUpAPIError as e:
            return CheckResult(
                success=False,
                error=f"ClickUp API error: {str(e)}",
                details={
                    "api_key_configured": True,
                    "webhook_secret_configured": True,
                    "api_connection": "failed"
                }
            )
        except Exception as e:
            return CheckResult(
                success=False,
                error=f"ClickUp connection error: {str(e)}",
                details={
                    "api_key_configured": True,
                    "webhook_secret_configured": True,
                    "api_connection": "error"
                }
            )
    else:
        # No test task, just verify credentials are set
        return CheckResult(
            success=True,
            warning="CLICKUP_TEST_TASK_ID not set - API connectivity not tested",
            details={
                "api_key_configured": True,
                "webhook_secret_configured": True,
                "api_connection": "not_tested"
            }
        )


def run_health_check(platform: str = "both") -> HealthCheckResult:
    """Run all health checks and return results.

    Args:
        platform: "github", "clickup", or "both" - which platform to check
    """
    result = HealthCheckResult(
        success=True, timestamp=datetime.now().isoformat(), checks={}
    )

    # Check environment variables
    env_check = check_env_vars(platform)
    result.checks["environment"] = env_check
    if not env_check.success:
        result.success = False
        if env_check.error:
            result.errors.append(env_check.error)
        # Add specific missing vars to errors
        missing_required = env_check.details.get("missing_required", [])
        result.errors.extend(
            [f"Missing required env var: {var}" for var in missing_required]
        )
    # Don't add warnings for optional env vars - they're optional!

    # GitHub-specific checks
    if platform in ["github", "both"]:
        # Check git repository
        git_check = check_git_repo()
        result.checks["git_repository"] = git_check
        if not git_check.success:
            result.success = False
            if git_check.error:
                result.errors.append(git_check.error)
        elif git_check.warning:
            result.warnings.append(git_check.warning)

        # Check GitHub CLI
        gh_check = check_github_cli()
        result.checks["github_cli"] = gh_check
        if not gh_check.success:
            result.success = False
            if gh_check.error:
                result.errors.append(gh_check.error)

    # ClickUp-specific checks
    if platform in ["clickup", "both"]:
        clickup_check = check_clickup_api()
        result.checks["clickup_api"] = clickup_check
        if not clickup_check.success:
            result.success = False
            if clickup_check.error:
                result.errors.append(clickup_check.error)
        elif clickup_check.warning:
            result.warnings.append(clickup_check.warning)

    # Check Claude Code - only if we have the API key (shared by both platforms)
    if os.getenv("ANTHROPIC_API_KEY"):
        claude_check = check_claude_code()
        result.checks["claude_code"] = claude_check
        if not claude_check.success:
            result.success = False
            if claude_check.error:
                result.errors.append(claude_check.error)
    else:
        result.checks["claude_code"] = CheckResult(
            success=False,
            details={"skipped": True, "reason": "ANTHROPIC_API_KEY not set"},
        )

    return result


def main():
    """Main entry point."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="ADW System Health Check")
    parser.add_argument(
        "--platform",
        choices=["github", "clickup", "both"],
        default="both",
        help="Platform to check (default: both)",
    )
    parser.add_argument(
        "issue_number",
        nargs="?",
        help="Optional GitHub issue number to post results to",
    )
    args = parser.parse_args()

    platform_name = args.platform.upper() if args.platform != "both" else "BOTH PLATFORMS"
    print(f"🏥 Running ADW System Health Check ({platform_name})...\n")

    result = run_health_check(args.platform)

    # Print summary
    print(
        f"{'✅' if result.success else '❌'} Overall Status: {'HEALTHY' if result.success else 'UNHEALTHY'}"
    )
    print(f"📅 Timestamp: {result.timestamp}\n")

    # Print detailed results
    print("📋 Check Results:")
    print("-" * 50)

    for check_name, check_result in result.checks.items():
        status = "✅" if check_result.success else "❌"
        print(f"\n{status} {check_name.replace('_', ' ').title()}:")

        # Print check-specific details
        for key, value in check_result.details.items():
            if value is not None and key not in [
                "missing_required",
                "missing_optional",
            ]:
                print(f"   {key}: {value}")

        if check_result.error:
            print(f"   ❌ Error: {check_result.error}")
        if check_result.warning:
            print(f"   ⚠️  Warning: {check_result.warning}")

    # Print warnings
    if result.warnings:
        print("\n⚠️  Warnings:")
        for warning in result.warnings:
            print(f"   - {warning}")

    # Print errors
    if result.errors:
        print("\n❌ Errors:")
        for error in result.errors:
            print(f"   - {error}")

    # Print next steps
    if not result.success:
        print("\n📝 Next Steps:")
        if any("ANTHROPIC_API_KEY" in e for e in result.errors):
            print("   1. Set ANTHROPIC_API_KEY in your .env file")
        if any("CLICKUP_API_KEY" in e for e in result.errors):
            print("   2. Set CLICKUP_API_KEY in your .env file")
        if any("CLICKUP_WEBHOOK_SECRET" in e for e in result.errors):
            print("   3. Set CLICKUP_WEBHOOK_SECRET in your .env file")
        if any("GITHUB_PAT" in e for e in result.errors):
            print("   4. Set GITHUB_PAT in your .env file (optional)")
        if any("GitHub CLI" in e for e in result.errors):
            print("   5. Install GitHub CLI: brew install gh")
            print("   6. Authenticate: gh auth login")
        if any("disler" in w for w in result.warnings):
            print(
                "   7. Fork/clone the repository and update git remote to your own repo"
            )
        if any("CLICKUP_TEST_TASK_ID" in w for w in result.warnings):
            print("   8. (Optional) Set CLICKUP_TEST_TASK_ID to test API connectivity")

    # If issue number provided, post comment
    if args.issue_number:
        print(f"\n📤 Posting health check results to issue #{args.issue_number}...")
        status_emoji = "✅" if result.success else "❌"
        comment = f"{status_emoji} Health check completed: {'HEALTHY' if result.success else 'UNHEALTHY'}"
        try:
            make_issue_comment(args.issue_number, comment)
            print(f"✅ Posted health check comment to issue #{args.issue_number}")
        except Exception as e:
            print(f"❌ Failed to post comment: {e}")

    # Return appropriate exit code
    sys.exit(0 if result.success else 1)


if __name__ == "__main__":
    main()
