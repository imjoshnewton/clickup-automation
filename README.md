# AI Developer Workflow (ADW) - Multi-Platform Automation

Automated development workflow with Claude Code for GitHub Issues and ClickUp Tasks.

## Platform Support

This system supports **two platforms** for triggering automated development workflows:

- **GitHub Issues**: Trigger workflows when issues are labeled or commented on
- **ClickUp Tasks**: Trigger workflows when tasks are created or commented on

Both platforms use the same AI-powered workflow engine and can be run simultaneously on the same server.

## How It Works

### Workflow Overview

1. **Platform Webhook** → Issue/Task event triggers webhook
2. **Secure Server** → Receives webhook via HTTPS with signature verification
3. **Claude Code** → Automatically executes the development workflow:
   - Gets work item details (issue or task)
   - Creates feature branch in isolated git worktree
   - Consults AI models for implementation plan
   - Implements changes
   - Runs linting and builds
   - Creates PR and updates work item

### Platform-Specific Triggers

**GitHub:**
- Issue labeled with specific label (e.g., "adw")
- Comment on issue with "adw" command

**ClickUp:**
- Task created in configured list
- Comment on task with "adw" command

## Security Architecture

### Connection Options:

#### Option 1: Domain with HTTPS (Recommended)
- ClickUp → `https://your-domain.com/webhook/clickup`
- SSL/TLS encryption
- Domain-based access

#### Option 2: Direct IP with Security
- ClickUp → `https://YOUR.SERVER.IP:3000/webhook/clickup`
- Requires SSL certificate for IP
- IP whitelisting available

### Security Layers:

1. **HMAC Signature Verification**
   - ClickUp signs webhooks with secret
   - Server verifies signature before processing

2. **IP Whitelisting** (Optional)
   - Note: ClickUp doesn't provide fixed IP ranges for webhooks
   - You can still whitelist your own testing IPs if needed
   - Set `ALLOWED_IPS` in `.env`

3. **HTTPS/SSL**
   - All webhook traffic encrypted
   - Use Nginx as reverse proxy (recommended)

4. **Rate Limiting**
   - Nginx configuration includes rate limiting
   - Prevents abuse

## Setup Instructions

### 1. Server Setup

```bash
# Clone repository on your server
git clone <this-repo>
cd clickup-automation

# Install uv (Python package manager used by ADW scripts)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Copy and configure environment
cp .env.example .env
# Edit .env with your values
```

### 2. Environment Configuration

The `.env.example` file is organized into sections for shared configuration and platform-specific settings.

#### Shared Configuration (Required)
```bash
# Core settings used by both platforms
PORT=8001                                  # Webhook server port
REPO_PATH=/path/to/your/repository         # Target git repository
CLAUDE_CODE_PATH=claude                    # Path to claude binary
ANTHROPIC_API_KEY=your-anthropic-api-key   # Claude Code SDK
LOG_DIR=./logs
WORKTREE_BASE_DIR=/tmp/claude-automation   # Git worktree isolation
```

#### GitHub Configuration (Optional)
Only needed if you want to use GitHub issues:

```bash
GITHUB_PAT=your-github-token               # Optional: for different GitHub account
E2B_API_KEY=your-e2b-key                   # Optional: sandbox environments
CLOUDFLARED_TUNNEL_TOKEN=your-token        # Optional: tunnel for webhook
CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=true
```

#### ClickUp Configuration (Optional)
Only needed if you want to use ClickUp tasks:

```bash
CLICKUP_API_KEY=your-clickup-api-key
CLICKUP_WEBHOOK_SECRET=your-webhook-secret
CLICKUP_LIST_ID=                           # Optional: filter to specific list
CLICKUP_TEST_TASK_ID=                      # Optional: for health checks
```

**Note:** You can configure both platforms or just one, depending on your needs.

### 3. Nginx Setup (Recommended)

```bash
# Copy nginx config
sudo cp nginx.conf.example /etc/nginx/sites-available/clickup-automation
# Edit with your domain and SSL paths
sudo ln -s /etc/nginx/sites-available/clickup-automation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Process Management

#### Using systemd (Recommended)
Systemd provides better integration with Claude Code SDK:

```bash
# Copy service file to user systemd directory
cp clickup-automation.service ~/.config/systemd/user/

# Enable and start service
systemctl --user daemon-reload
systemctl --user enable clickup-automation
systemctl --user start clickup-automation

# Check status
systemctl --user status clickup-automation
```

#### Alternative: Using PM2
Note: PM2 has compatibility issues with Claude Code SDK. Use systemd instead.

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 5. Platform Configuration

#### GitHub Setup

The GitHub webhook system uses the existing `trigger_webhook.py` server:

1. **Install GitHub CLI and authenticate:**
   ```bash
   brew install gh  # or your package manager
   gh auth login
   ```

2. **Start the GitHub webhook server:**
   ```bash
   # Using the Python script directly
   uv run adws/trigger_webhook.py
   ```

3. **Configure GitHub webhook** (if using remote webhooks):
   - Go to repository settings → Webhooks
   - Add webhook URL: `https://your-domain.com/gh-webhook`
   - Set content type: `application/json`
   - Configure events: Issues, Issue comments

4. **Or use it manually** with issue numbers:
   ```bash
   uv run adws/adw_plan_build.py --platform github --issue 123
   ```

#### ClickUp Setup

The ClickUp webhook system uses the new `trigger_clickup_webhook.py` server:

1. **Start the ClickUp webhook server:**
   ```bash
   # Using the Python script directly
   uv run adws/trigger_clickup_webhook.py
   ```

2. **Configure ClickUp webhook:**
   - Go to your ClickUp Space/List settings
   - Navigate to Webhooks
   - Create new webhook:
     - **URL**: `https://your-domain.com/clickup-webhook`
     - **Events**: Task Created, Task Comment Posted
     - **Secret**: Your `CLICKUP_WEBHOOK_SECRET`

3. **Or use it manually** with task IDs:
   ```bash
   uv run adws/adw_plan_build.py --platform clickup --task-id abc123
   ```

#### Running Both Platforms

You can run both webhook servers simultaneously on different ports or use a reverse proxy (Nginx) to route to both:

```bash
# Terminal 1: GitHub webhooks
PORT=8000 uv run adws/trigger_webhook.py

# Terminal 2: ClickUp webhooks
PORT=8001 uv run adws/trigger_clickup_webhook.py
```

## Testing

### Health Checks

Run comprehensive health checks for platform validation:

```bash
# Check both platforms
uv run adws/health_check.py --platform both

# Check only GitHub
uv run adws/health_check.py --platform github

# Check only ClickUp
uv run adws/health_check.py --platform clickup
```

The health check validates:
- Environment variables (platform-specific)
- API connectivity (GitHub CLI or ClickUp API)
- Claude Code functionality
- Git repository configuration

### Manual Testing

#### GitHub
```bash
# Test GitHub workflow directly
uv run adws/adw_plan_build.py --platform github --issue 123 --adw-id test-run-001

# Or use legacy positional arguments (defaults to GitHub)
uv run adws/adw_plan_build.py 123 test-run-001
```

#### ClickUp
```bash
# Test ClickUp workflow directly
uv run adws/adw_plan_build.py --platform clickup --task-id abc123 --adw-id test-run-001

# Test webhook endpoint
curl -X POST http://localhost:8001/clickup-webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: your-webhook-secret" \
  -d '{"event": "taskCreated", "task_id": "abc123"}'

# Test with comment trigger
curl -X POST http://localhost:8001/clickup-webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: your-webhook-secret" \
  -d '{"event": "taskCommentPosted", "task_id": "abc123", "comment": {"comment_text": "adw"}}'
```

### Logs

Logs are organized by ADW ID:
```bash
# View logs for a specific workflow
tail -f agents/<adw-id>/adw_plan_build/execution.log

# Check webhook server logs
journalctl --user -u clickup-automation -f  # For systemd
tail -f logs/automation_*.log                # Legacy PM2 logs
```

## Monitoring

### Health Checks
Both webhook servers expose health check endpoints:
- GitHub: `http://localhost:8000/health`
- ClickUp: `http://localhost:8001/health`

Or run comprehensive checks:
```bash
uv run adws/health_check.py --platform both
```

### Logs
- Workflow logs: `agents/<adw-id>/adw_plan_build/execution.log`
- Legacy logs: `./logs/automation_TASKID_TIMESTAMP.log`
- Systemd logs: `journalctl --user -u clickup-automation -f`

## Security Best Practices

1. **Never expose the server directly** - Always use HTTPS
2. **Rotate webhook secret** regularly
3. **Monitor logs** for suspicious activity
4. **Limit server access** - Only webhook port exposed
5. **Keep Claude Code API key** secure
6. **Use firewall rules** to restrict access

## Architecture

### Platform Adapter Pattern

The system uses a **platform adapter pattern** to provide a unified interface for both GitHub and ClickUp:

```
adw_plan_build.py (Orchestrator)
        ↓
platform_adapter.py (Abstraction Layer)
        ↓
    /       \
   /         \
github.py  clickup.py (Platform-Specific)
```

Key components:
- `adws/adw_plan_build.py` - Main workflow orchestrator
- `adws/platform_adapter.py` - Unified interface for both platforms
- `adws/github.py` - GitHub-specific operations (unchanged)
- `adws/clickup.py` - ClickUp-specific operations (new)
- `adws/data_types.py` - Shared data models (WorkItem abstraction)

### Webhook Servers

- `adws/trigger_webhook.py` - GitHub webhook server (unchanged)
- `adws/trigger_clickup_webhook.py` - ClickUp webhook server (new)

Both servers launch `adw_plan_build.py` as a background process with appropriate platform flags.

## Troubleshooting

### General Issues
- **Claude Code errors**: Check logs and verify `ANTHROPIC_API_KEY` is set correctly
- **Git operations fail**: Verify SSH keys and repository access
- **Worktree errors**: Ensure `WORKTREE_BASE_DIR` is writable and has space

### GitHub-Specific
- **Webhook not received**: Check GitHub webhook configuration and delivery logs
- **Authentication fails**: Run `gh auth status` and re-authenticate if needed
- **Issue operations fail**: Verify `gh` CLI has repository access

### ClickUp-Specific
- **Webhook not received**: Check ClickUp webhook configuration in Space settings
- **Signature verification fails**: Ensure `CLICKUP_WEBHOOK_SECRET` matches webhook configuration exactly
- **API errors**: Verify `CLICKUP_API_KEY` is valid and has proper permissions
- **Task not found**: Check that ClickUp MCP tools are configured (see Claude Code MCP setup)

### Platform Adapter Issues
- **Import errors**: Ensure all Python dependencies are installed via `uv`
- **Platform detection fails**: Use explicit `--platform` flag instead of relying on defaults