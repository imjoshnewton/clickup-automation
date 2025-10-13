#!/usr/bin/env -S uv run
# /// script
# dependencies = ["fastapi", "uvicorn", "python-dotenv"]
# ///

"""
ClickUp Webhook Trigger - AI Developer Workflow (ADW)

FastAPI webhook endpoint that receives ClickUp task events and triggers ADW workflows.
Responds immediately to meet ClickUp's timeout by launching adw_plan_build.py
in the background.

Usage: uv run trigger_clickup_webhook.py

Environment Requirements:
- PORT: Server port (default: 8001)
- CLICKUP_WEBHOOK_SECRET: Secret for webhook signature verification
- CLICKUP_API_KEY: ClickUp API key
- All adw_plan_build.py requirements (ANTHROPIC_API_KEY, etc.)
"""

import os
import subprocess
import sys
from fastapi import FastAPI, Request
from dotenv import load_dotenv
import uvicorn
from utils import make_adw_id

# Load environment variables
load_dotenv()

# Configuration
PORT = int(os.getenv("PORT", "8001"))
CLICKUP_WEBHOOK_SECRET = os.getenv("CLICKUP_WEBHOOK_SECRET")
CLICKUP_LIST_ID = os.getenv("CLICKUP_LIST_ID")  # Optional: filter to specific list

# Create FastAPI app
app = FastAPI(
    title="ADW ClickUp Webhook Trigger", description="ClickUp webhook endpoint for ADW"
)

print(f"Starting ADW ClickUp Webhook Trigger on port {PORT}")


def verify_clickup_signature(signature: str) -> bool:
    """
    Verify ClickUp webhook signature.

    ClickUp uses simple token comparison (not HMAC like GitHub).

    Args:
        signature: X-Signature header value

    Returns:
        bool: True if signature is valid
    """
    if not CLICKUP_WEBHOOK_SECRET:
        print("Warning: CLICKUP_WEBHOOK_SECRET not set - signature verification disabled")
        return True

    return signature == CLICKUP_WEBHOOK_SECRET


@app.post("/clickup-webhook")
async def clickup_webhook(request: Request):
    """Handle ClickUp webhook events."""
    try:
        print("🚀 ClickUp webhook endpoint hit!")

        # Get signature from header
        signature = request.headers.get("x-signature") or request.headers.get(
            "X-Signature"
        )

        print("Received signature:", signature)
        print("Expected signature:", CLICKUP_WEBHOOK_SECRET)

        # Verify signature
        if not verify_clickup_signature(signature):
            print("❌ Invalid webhook signature")
            print("Received:", signature)
            print("Expected:", CLICKUP_WEBHOOK_SECRET)
            return {"status": "error", "error": "Invalid signature"}

        print("✅ Authentication passed")

        # Parse webhook payload
        try:
            payload = await request.json()
        except Exception as parse_error:
            print("❌ JSON parse error:", parse_error)
            return {"status": "error", "error": "Invalid JSON"}

        # Log the entire payload
        print("📦 ClickUp payload:", payload)

        # Check if this is a test webhook from ClickUp
        if payload.get("event") == "ping":
            print("✅ Received ping webhook from ClickUp")
            return {"status": "ok", "message": "Pong! Webhook is configured correctly"}

        # Extract event details
        event = payload.get("event", "")
        task_id = payload.get("task_id")

        # Handle different payload structures
        if not task_id and "history_items" in payload:
            # Some webhooks have task_id in history_items
            history = payload.get("history_items", [])
            if history and len(history) > 0:
                task_id = history[0].get("task_id")

        print("🔍 Extracted task_id:", task_id)
        print("🔍 Extracted event:", event)

        if not task_id:
            print("❌ No task_id found in payload:", payload)
            return {"status": "error", "error": "No task_id provided"}

        # Determine if this event should trigger ADW
        should_trigger = False
        trigger_reason = ""

        # Task created event
        if event == "taskCreated":
            should_trigger = True
            trigger_reason = "New task created"

            # Optional: Check if task is in configured list
            if CLICKUP_LIST_ID:
                list_id = payload.get("list_id")
                if list_id != CLICKUP_LIST_ID:
                    should_trigger = False
                    trigger_reason = f"Task not in configured list {CLICKUP_LIST_ID}"

        # Task comment posted event
        elif event == "taskCommentPosted":
            # Check if comment text is "adw"
            comment_text = payload.get("comment", {}).get("comment_text", "").strip().lower()
            print(f"Comment text: '{comment_text}'")

            if comment_text == "adw":
                should_trigger = True
                trigger_reason = "Comment with 'adw' command"

        if should_trigger:
            # Generate ADW ID for this workflow
            adw_id = make_adw_id()

            # Build command to run adw_plan_build.py with adw_id
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            trigger_script = os.path.join(script_dir, "adw_plan_build.py")

            cmd = [
                "uv",
                "run",
                trigger_script,
                "--platform",
                "clickup",
                "--task-id",
                task_id,
                "--adw-id",
                adw_id,
            ]

            print(f"Launching background process: {' '.join(cmd)} (reason: {trigger_reason})")

            # Launch in background using Popen
            process = subprocess.Popen(
                cmd, cwd=project_root, env=os.environ.copy()  # Run from project root
            )

            print(
                f"Background process started for task #{task_id} with ADW ID: {adw_id}"
            )
            print(f"Logs will be written to: agents/{adw_id}/adw_plan_build/execution.log")

            # Return immediately
            return {
                "status": "accepted",
                "task": task_id,
                "adw_id": adw_id,
                "message": f"ADW workflow triggered for task #{task_id}",
                "reason": trigger_reason,
                "logs": f"agents/{adw_id}/adw_plan_build/",
            }
        else:
            print(
                f"Ignoring webhook: event={event}, task_id={task_id}, reason={trigger_reason or 'Not a triggering event'}"
            )
            return {
                "status": "ignored",
                "reason": trigger_reason
                or f"Not a triggering event (event={event})",
            }

    except Exception as e:
        print(f"Error processing webhook: {e}")
        # Always return 200 to ClickUp to prevent retries
        return {"status": "error", "message": "Internal error processing webhook"}


@app.get("/health")
async def health():
    """Health check endpoint - runs comprehensive system health check."""
    try:
        # Run the health check script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        health_check_script = os.path.join(script_dir, "health_check.py")

        # Run health check with timeout
        result = subprocess.run(
            ["uv", "run", health_check_script, "--platform", "clickup"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=script_dir,
        )

        # Print the health check output for debugging
        print("=== Health Check Output ===")
        print(result.stdout)
        if result.stderr:
            print("=== Health Check Errors ===")
            print(result.stderr)

        # Parse the output - look for the overall status
        is_healthy = result.returncode == 0

        # Extract key information from output
        warnings = []
        errors = []

        capturing_warnings = False
        capturing_errors = False

        for line in result.stdout.strip().split("\n"):
            if "⚠️  Warnings:" in line or "⚠️ Warnings:" in line:
                capturing_warnings = True
                capturing_errors = False
                continue
            elif "❌ Errors:" in line:
                capturing_errors = True
                capturing_warnings = False
                continue
            elif "📝 Next Steps:" in line:
                break

            if capturing_warnings and line.strip().startswith("-"):
                warnings.append(line.strip()[2:])
            elif capturing_errors and line.strip().startswith("-"):
                errors.append(line.strip()[2:])

        return {
            "status": "healthy" if is_healthy else "unhealthy",
            "service": "adw-clickup-webhook-trigger",
            "health_check": {
                "success": is_healthy,
                "warnings": warnings,
                "errors": errors,
                "details": "Run health_check.py --platform clickup directly for full report",
            },
        }

    except subprocess.TimeoutExpired:
        return {
            "status": "unhealthy",
            "service": "adw-clickup-webhook-trigger",
            "error": "Health check timed out",
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "service": "adw-clickup-webhook-trigger",
            "error": f"Health check failed: {str(e)}",
        }


if __name__ == "__main__":
    print(f"Starting server on http://0.0.0.0:{PORT}")
    print(f"Webhook endpoint: POST /clickup-webhook")
    print(f"Health check: GET /health")

    uvicorn.run(app, host="0.0.0.0", port=PORT)
