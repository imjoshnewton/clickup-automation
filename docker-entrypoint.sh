#!/bin/bash
set -e

# Ensure SSH agent is available if needed
if [ -S "$SSH_AUTH_SOCK" ]; then
    echo "SSH agent detected"
fi

# Set Git configuration in a writable location if mounted .gitconfig is read-only
if [ ! -w /home/joshnewton/.gitconfig ] 2>/dev/null; then
    echo "Setting up Git configuration in container..."
    export GIT_CONFIG_GLOBAL=/tmp/.gitconfig
    git config --global user.name "${GIT_USER_NAME:-Claude Automation}"
    git config --global user.email "${GIT_USER_EMAIL:-automation@example.com}"
    git config --global --add safe.directory /home/joshnewton/Development/clarify-your-compass
    echo "✅ Git configured with safe directories"
else
    echo "Using existing Git configuration"
    # Still need to add safe directory
    git config --global --add safe.directory /home/joshnewton/Development/clarify-your-compass 2>/dev/null || \
        echo "⚠️ Could not add safe directory to global config, using GIT_CONFIG_GLOBAL"
    if [ $? -ne 0 ]; then
        export GIT_CONFIG_GLOBAL=/tmp/.gitconfig
        git config --global --add safe.directory /home/joshnewton/Development/clarify-your-compass
    fi
    echo "✅ Repository added to Git safe directories"
fi

# Set correct permissions for SSH keys (skip if read-only)
if [ -d /home/joshnewton/.ssh ]; then
    chmod 700 /home/joshnewton/.ssh 2>/dev/null || echo "SSH directory is read-only (expected in container)"
    chmod 600 /home/joshnewton/.ssh/* 2>/dev/null || echo "SSH files are read-only (expected in container)"
fi

# Set correct repository path in environment
export REPO_PATH="${REPO_PATH:-/home/joshnewton/Development/clarify-your-compass}"

# Alternative: Use a different worktree location with proper permissions
export WORKTREE_BASE_DIR="/tmp/git-worktrees"
mkdir -p "$WORKTREE_BASE_DIR"
chmod 755 "$WORKTREE_BASE_DIR"

# MCP configuration is already set up during build
echo "🔧 MCP configuration ready"

# Ensure log directory exists and is writable (use tmp if mounted logs not writable)
if ! mkdir -p /app/logs 2>/dev/null || ! touch /app/logs/test.log 2>/dev/null; then
    echo "⚠️ /app/logs not writable, using /tmp/logs instead"
    export LOG_DIR=/tmp/logs
    mkdir -p /tmp/logs
else
    rm -f /app/logs/test.log 2>/dev/null
    export LOG_DIR=/app/logs
fi

# Ensure tmp directory exists for worktrees
mkdir -p /tmp/claude-automation

echo "🐳 Docker container starting..."
echo "📁 Repo path: $REPO_PATH"
echo "🔧 Working directory: $(pwd)"
echo "👤 User: $(whoami)"

# Execute the main command
exec "$@"