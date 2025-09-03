import express from 'express';
import { spawn } from 'child_process';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import https from 'https';

config();

const app = express();
app.use(express.raw({ type: 'application/json' }));

const PORT = process.env.PORT || 3000;
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const REPO_PATH = process.env.REPO_PATH || '/path/to/your/repo';
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || 'claude-code';
const ALLOWED_IPS = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [];

function verifyClickUpSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return hash === signature;
}

function ipWhitelistMiddleware(req, res, next) {
  if (ALLOWED_IPS.length > 0) {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const isAllowed = ALLOWED_IPS.some(ip => clientIp.includes(ip));
    
    if (!isAllowed) {
      console.log(`Rejected request from unauthorized IP: ${clientIp}`);
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
}

app.post('/webhook/clickup', ipWhitelistMiddleware, async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-signature'];
    
    if (CLICKUP_WEBHOOK_SECRET) {
      if (!signature || !verifyClickUpSignature(payload, signature, CLICKUP_WEBHOOK_SECRET)) {
        console.log('Invalid webhook signature');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    const body = JSON.parse(payload.toString());

    const { task_id, event } = body;
    
    if (!task_id) {
      return res.status(400).json({ error: 'No task_id provided' });
    }

    console.log(`Received ClickUp webhook for task ${task_id}, event: ${event}`);
    
    res.status(200).json({ message: 'Webhook received, processing task' });

    processTask(task_id);

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function processTask(taskId) {
  try {
    console.log(`Starting automation for task ${taskId}`);
    
    const prompt = `Get the ClickUp task by ID ${taskId} from the Development Pipeline list, set its status to in progress, read the instructions in the task description, create a new branch for these changes with the template {clickup_id}/{task_type}/{feature or task name}, think hard about your plan to implement these changes and ask for input from 2-3 thinking models with high reasoning from the ai models mcp server, implement the plan and then lint and build to check for errors. When you are done commit and push the changes, create a detailed PR with a target of the main branch, use the information you have to fill out the custom fields for the clickup task, and set the task to ready for review (dev).`;

    const logFile = `automation_${taskId}_${Date.now()}.log`;
    const logPath = path.join(process.env.LOG_DIR || './logs', logFile);
    
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    
    const logStream = await fs.open(logPath, 'w');
    
    const claudeCode = spawn(CLAUDE_CODE_PATH, [], {
      cwd: REPO_PATH,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      }
    });

    claudeCode.stdin.write(prompt + '\n');
    claudeCode.stdin.end();

    claudeCode.stdout.on('data', async (data) => {
      const output = data.toString();
      console.log('Claude Code:', output);
      await logStream.write(`[STDOUT] ${output}\n`);
    });

    claudeCode.stderr.on('data', async (data) => {
      const error = data.toString();
      console.error('Claude Code Error:', error);
      await logStream.write(`[STDERR] ${error}\n`);
    });

    claudeCode.on('close', async (code) => {
      console.log(`Claude Code process exited with code ${code}`);
      await logStream.write(`\n[COMPLETE] Process exited with code ${code}\n`);
      await logStream.close();
      
      if (code === 0) {
        console.log(`Task ${taskId} completed successfully. Log: ${logPath}`);
      } else {
        console.error(`Task ${taskId} failed. Check log: ${logPath}`);
      }
    });

  } catch (error) {
    console.error(`Error processing task ${taskId}:`, error);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`ClickUp automation server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://your-server.com:${PORT}/webhook/clickup`);
  console.log(`Repository path: ${REPO_PATH}`);
});