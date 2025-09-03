# Claude Code Server Setup Instructions

This document is for Claude Code to set up the ClickUp automation system on the server.

## Prerequisites Check
- Node.js or Bun installed
- PM2 installed globally (`npm install -g pm2`)
- Git configured with access to development repositories
- Nginx installed (optional but recommended)
- Claude Code CLI configured with Anthropic API key

## Setup Steps

### 1. Clone and Install
```bash
cd /opt/automations  # or your preferred directory
git clone [REPO_URL] clickup-automation
cd clickup-automation
bun install  # or npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```

Edit `.env` and configure:
- `PORT`: Keep default 3000 unless already in use
- `CLICKUP_WEBHOOK_SECRET`: Generate a secure random string (32+ characters)
- `REPO_PATH`: Path to the main development repository that tasks will modify
- `CLAUDE_CODE_PATH`: Path to claude-code binary (usually just 'claude-code')
- `LOG_DIR`: Directory for automation logs (default: ./logs)
- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude Code

### 3. Test Claude Code Integration
Verify Claude Code can be called programmatically:
```bash
echo "What is 2+2?" | claude-code
```

### 4. Create Required Directories
```bash
mkdir -p logs
chmod 755 logs
```

### 5. Test Server Locally
```bash
# Run in foreground to test
node server.js

# In another terminal, test the health endpoint
curl http://localhost:3000/health
```

### 6. Set Up PM2 Process Management
```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
# Follow the command it outputs
```

### 7. Configure Nginx (If Available)
```bash
# Copy and customize nginx config
sudo cp nginx.conf.example /etc/nginx/sites-available/clickup-automation

# Edit the file with your domain and SSL paths
sudo nano /etc/nginx/sites-available/clickup-automation

# Enable the site
sudo ln -s /etc/nginx/sites-available/clickup-automation /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 8. SSL Certificate Setup (Required for HTTPS)
If using Let's Encrypt:
```bash
sudo certbot --nginx -d your-domain.com
```

Or place existing certificates and update nginx config paths.

### 9. Firewall Configuration
```bash
# If using UFW
sudo ufw allow 'Nginx Full'  # or allow your specific port
```

### 10. Test Webhook Endpoint
```bash
# Get your server's public URL
# If using domain: https://your-domain.com/webhook/clickup
# If using IP: http://YOUR.SERVER.IP:3000/webhook/clickup

# Test with curl (replace with your values)
curl -X POST https://your-domain.com/webhook/clickup \
  -H "Content-Type: application/json" \
  -H "X-Signature: YOUR_WEBHOOK_SECRET" \
  -d '{"task_id": "test123", "event": "test"}'
```

### 11. Repository Setup
Ensure the development repository specified in `REPO_PATH`:
- Has proper Git configuration
- Has SSH keys set up for GitHub/GitLab
- Has the main branch checked out
- Has no uncommitted changes

Test Git access:
```bash
cd $REPO_PATH
git fetch origin
git status
```

### 12. ClickUp Configuration
After server is running, configure ClickUp:

1. Note your webhook URL:
   - With Nginx/domain: `https://your-domain.com/webhook/clickup`
   - Direct (testing): `http://YOUR.SERVER.IP:3000/webhook/clickup`

2. In ClickUp:
   - Go to the target Space/List
   - Create new Automation
   - Trigger: "When status changes to [your trigger status]"
   - Action: "Send Webhook"
   - URL: Your webhook URL from step 1
   - Method: POST
   - Headers: Add `X-Signature: YOUR_WEBHOOK_SECRET_FROM_ENV`

### 13. Monitoring Setup
```bash
# View PM2 logs
pm2 logs clickup-automation

# Monitor process
pm2 monit

# Check automation logs
tail -f logs/automation_*.log
```

## Troubleshooting Commands

```bash
# Check if server is running
pm2 status

# Restart server
pm2 restart clickup-automation

# Check recent logs
pm2 logs clickup-automation --lines 50

# Test Claude Code is working
echo "Hello" | claude-code

# Check nginx status
sudo systemctl status nginx

# Check firewall
sudo ufw status
```

## Security Checklist
- [ ] Strong webhook secret (32+ characters)
- [ ] HTTPS configured (not HTTP)
- [ ] Firewall configured
- [ ] PM2 running as non-root user
- [ ] Logs directory has proper permissions
- [ ] Environment file permissions: `chmod 600 .env`
- [ ] No sensitive data in repository

## Testing the Full Workflow
1. Create a test task in ClickUp
2. Change its status to your trigger status
3. Check PM2 logs: `pm2 logs clickup-automation`
4. Check automation logs: `ls -la logs/`
5. Verify branch creation and PR in your repository

## Notes for Claude Code
- Each webhook trigger spawns a new Claude Code process
- Logs are saved per task in `logs/automation_TASKID_TIMESTAMP.log`
- The server responds immediately to webhooks, processing happens async
- Git operations happen in the `REPO_PATH` directory
- Make sure MCP servers for ClickUp and AI Models are configured