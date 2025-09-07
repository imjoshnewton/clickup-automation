# ClickUp Task Automation with Claude Code

Automated development workflow triggered by ClickUp task status changes.

## How It Works

1. **ClickUp Webhook** → Task status change triggers webhook
2. **Secure Server** → Receives webhook via HTTPS with signature verification
3. **Claude Code** → Automatically executes the development workflow:
   - Gets task details from ClickUp
   - Creates feature branch
   - Consults AI models for implementation plan
   - Implements changes
   - Runs linting and builds
   - Creates PR and updates ClickUp task

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

# Install dependencies
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env with your values
```

### 2. Environment Configuration

```bash
# Required
CLICKUP_WEBHOOK_SECRET=generate-a-strong-secret-here
REPO_PATH=/path/to/your/development/repo
ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional Security
# Note: ClickUp doesn't provide fixed webhook IPs
# Add your own testing/development IPs if needed
# ALLOWED_IPS=your.testing.ip.here
```

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

### 5. ClickUp Configuration

1. Go to your ClickUp Space/List settings
2. Navigate to Automations
3. Create new automation:
   - **Trigger**: "Status changes to" → Select your trigger status
   - **Action**: "Send webhook"
   - **URL**: `https://your-domain.com/webhook/clickup`
   - **Headers**: Add `X-Signature: YOUR_WEBHOOK_SECRET`

## Testing

### Test Mode
Tasks with IDs containing "test" automatically run in test mode with simplified automation:
- Creates test files instead of real implementation
- Makes commits and PRs for testing the automation infrastructure
- **Does NOT make ClickUp API calls** (safe for testing)
- Automatically cleans up worktrees after completion

### Manual Testing
```bash
# Test webhook endpoint with test task ID
curl -X POST http://localhost:3000/webhook/clickup \
  -H "Content-Type: application/json" \
  -H "X-Signature: your-webhook-secret" \
  -d '{"task_id": "test999", "event": "taskUpdated", "history_items": [{"field": "status", "after": {"status": "In Progress"}}]}'

# Test with production task ID (will make real ClickUp API calls)
curl -X POST http://localhost:3000/webhook/clickup \
  -H "Content-Type: application/json" \
  -H "X-Signature: your-webhook-secret" \
  -d '{"task_id": "abc123", "event": "taskUpdated", "history_items": [{"field": "status", "after": {"status": "In Progress"}}]}'

# Check logs
systemctl --user status clickup-automation  # For systemd
journalctl --user -u clickup-automation -f  # Follow systemd logs
# or
tail -f logs/automation_*.log
```

## Monitoring

- Logs stored in `./logs/automation_TASKID_TIMESTAMP.log`
- Health check: `https://your-domain.com/health`
- PM2 monitoring: `pm2 monit`

## Security Best Practices

1. **Never expose the server directly** - Always use HTTPS
2. **Rotate webhook secret** regularly
3. **Monitor logs** for suspicious activity
4. **Limit server access** - Only webhook port exposed
5. **Keep Claude Code API key** secure
6. **Use firewall rules** to restrict access

## Troubleshooting

- **Webhook not received**: Check ClickUp automation and firewall rules
- **Signature verification fails**: Ensure secrets match exactly
- **Claude Code errors**: Check logs and API key permissions
- **Git operations fail**: Verify SSH keys and repository access