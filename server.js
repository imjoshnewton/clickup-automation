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
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

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

// Handle both /webhook/clickup and /webhook/clickup/:taskId
app.post(['/webhook/clickup', '/webhook/clickup/:taskId'], ipWhitelistMiddleware, async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-signature'];
    
    if (CLICKUP_WEBHOOK_SECRET) {
      // Simple token comparison - ClickUp sends the secret directly, not as HMAC
      if (!signature || signature !== CLICKUP_WEBHOOK_SECRET) {
        console.log('Invalid webhook signature');
        console.log('Received:', signature);
        console.log('Expected:', CLICKUP_WEBHOOK_SECRET);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    const body = JSON.parse(payload.toString());
    
    // Log the entire payload to see what ClickUp sends
    console.log('ClickUp payload:', JSON.stringify(body, null, 2));

    // Check if this is a test webhook from ClickUp
    if (body.body === 'Test message from ClickUp Webhooks Service') {
      console.log('Received test webhook from ClickUp');
      return res.status(200).json({ success: true, message: 'Test webhook received' });
    }

    // Get task_id from URL params first, then fall back to body
    const task_id = req.params.taskId || body.task_id || body.id || (body.task && body.task.id);
    const event = body.event || body.history_items?.[0]?.field || 'unknown';
    
    // Log if we got the ID from URL
    if (req.params.taskId) {
      console.log(`Task ID from URL: ${req.params.taskId}`);
    }
    
    if (!task_id) {
      console.log('No task_id found in payload:', body);
      return res.status(400).json({ error: 'No task_id provided' });
    }

    console.log(`Received ClickUp webhook for task ${task_id}, event: ${event}`);
    
    // Simple success response for ClickUp
    res.status(200).json({ success: true });

    processTask(task_id, body);

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function updateClickUpTaskStatus(taskId, status) {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;
  const data = JSON.stringify({ status });
  
  return new Promise((resolve, reject) => {
    const options = {
      method: 'PUT',
      headers: {
        'Authorization': CLICKUP_API_KEY,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getClickUpTask(taskId) {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;
  
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'Authorization': CLICKUP_API_KEY
      }
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function setClickUpCustomField(taskId, fieldName, value) {
  // First get the task to find the custom field ID
  const task = await getClickUpTask(taskId);
  const customField = task.custom_fields?.find(field => field.name === fieldName);
  
  if (!customField) {
    throw new Error(`Custom field "${fieldName}" not found`);
  }

  const url = `https://api.clickup.com/api/v2/task/${taskId}/field/${customField.id}`;
  const data = JSON.stringify({ value });
  
  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Authorization': CLICKUP_API_KEY,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData ? JSON.parse(responseData) : {});
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Helper function to handle automation completion (PR updates, custom fields, status change)
async function handleAutomationCompletion(taskId, automationBranchName, worktreePath, resultText = null) {
  const logProgress = (msg, err = false) => console.log(`${new Date().toISOString()}: ${msg}`);
  
  try {
    await logProgress('🎯 Starting automation completion steps...');
    
    // Get PR details first
    const getPRDetails = spawn('gh', ['pr', 'list', '--head', automationBranchName, '--state', 'open', '--json', 'url,headRefName,createdAt', '--limit', '1'], {
      cwd: REPO_PATH
    });
    
    let prDetailsOutput = '';
    getPRDetails.stdout.on('data', (data) => prDetailsOutput += data.toString());
    
    await new Promise((resolve) => {
      getPRDetails.on('close', async (detailsCode) => {
        if (detailsCode === 0 && prDetailsOutput.trim()) {
          try {
            const prDetails = JSON.parse(prDetailsOutput);
            // Only use PR if created in last 10 minutes
            if (prDetails.length > 0) {
              const createdAt = new Date(prDetails[0].createdAt);
              const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
              if (createdAt < tenMinutesAgo) {
                await logProgress('Found PR is too old, not from current automation');
                resolve();
                return;
              }
              const prUrl = prDetails[0].url;
              const branchName = prDetails[0].headRefName;
              
              await logProgress(`Updating custom fields - Branch: ${branchName}, PR: ${prUrl}`);
              
              // Update GitHub Branch custom field
              try {
                await setClickUpCustomField(taskId, 'GitHub Branch', branchName);
                await logProgress('✅ GitHub Branch field updated');
              } catch (error) {
                await logProgress(`⚠️ Failed to update GitHub Branch: ${error.message}`);
              }
              
              // Update GitHub Pull Request URL custom field
              try {
                await setClickUpCustomField(taskId, 'GitHub Pull Request URL', prUrl);
                await logProgress('✅ GitHub Pull Request URL field updated');
              } catch (error) {
                await logProgress(`⚠️ Failed to update GitHub Pull Request URL: ${error.message}`);
              }
              
              // Update task status to "Ready for Review (DEV)"
              try {
                await updateClickUpTaskStatus(taskId, 'Ready for Review (DEV)');
                await logProgress('✅ Task status updated to "Ready for Review (DEV)"');
              } catch (error) {
                await logProgress(`⚠️ Failed to update task status: ${error.message}`);
              }
              
              await logProgress('🎉 All automation completion steps finished!');
            }
          } catch (parseError) {
            await logProgress(`⚠️ Failed to parse PR details: ${parseError.message}`);
          }
        } else {
          await logProgress('No PR found for completion handling');
        }
        
        // Cleanup worktree after completion
        try {
          await logProgress('Cleaning up git worktree...');
          const removeWorktree = spawn('git', ['worktree', 'remove', '--force', worktreePath], {
            cwd: REPO_PATH
          });
          
          await new Promise((resolve) => {
            removeWorktree.on('close', async (removeCode) => {
              if (removeCode === 0) {
                await logProgress('✅ Git worktree cleaned up successfully');
              } else {
                await logProgress(`⚠️ Git worktree cleanup failed with code ${removeCode}`);
              }
              resolve();
            });
          });
        } catch (cleanupError) {
          await logProgress(`⚠️ Worktree cleanup error: ${cleanupError.message}`);
        }
        
        resolve();
      });
    });
  } catch (error) {
    await logProgress(`⚠️ Automation completion error: ${error.message}`);
  }
}

async function processTask(taskId, webhookPayload) {
  try {
    console.log(`Starting automation for task ${taskId}`);
    
    // First, get full task details from ClickUp API
    let taskData;
    try {
      taskData = await getClickUpTask(taskId);
      console.log(`Retrieved task: ${taskData.name}`);
    } catch (error) {
      console.error('Failed to retrieve task details:', error);
      taskData = webhookPayload.payload || {};
    }
    
    const taskName = taskData.name || taskId;
    const taskDescription = taskData.description || taskData.text_content || '';
    const customFields = taskData.custom_fields || [];
    
    console.log(`Task: ${taskName}`);
    console.log(`Description preview: ${taskDescription.substring(0, 100)}...`);
    
    // Create git worktree for this task
    const worktreePath = path.join(process.env.WORKTREE_BASE_DIR || '/tmp/claude-automation', `task-${taskId}`);
    try {
      console.log(`Creating git worktree at: ${worktreePath}`);
      
      // Remove existing worktree if it exists
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
      } catch (e) { /* ignore if doesn't exist */ }
      
      // Ensure base directory exists
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      
      // Determine task type from task name and description
      const taskNameLower = taskName.toLowerCase();
      const taskDescLower = taskDescription?.toLowerCase() || '';
      
      let taskType = 'feature'; // default
      if (taskNameLower.includes('fix') || taskNameLower.includes('bug') || taskDescLower.includes('fix') || taskDescLower.includes('bug')) {
        taskType = 'fix';
      } else if (taskNameLower.includes('update') || taskNameLower.includes('enhance') || taskNameLower.includes('improve') || taskNameLower.includes('change')) {
        taskType = 'update';
      } else if (taskNameLower.includes('chore') || taskNameLower.includes('refactor') || taskNameLower.includes('cleanup')) {
        taskType = 'chore';
      }
      
    // Create descriptive name from task name
    const descriptiveName = taskName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .slice(0, 50); // Limit length
      
    const branchName = `${taskId}/${taskType}/${descriptiveName}`;
    
    const createWorktree = spawn('git', ['worktree', 'add', '-b', branchName, worktreePath, 'origin/main'], {
      cwd: REPO_PATH
    });
    
    let stderr = '';
    let stdout = '';
    
    createWorktree.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    createWorktree.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    await new Promise((resolve, reject) => {
      createWorktree.on('close', async (code) => {
          if (code === 0) {
            console.log('✅ Git worktree created successfully');
            console.log('Git stdout:', stdout);
            
            // Copy .env file to worktree for database connections and testing
            try {
              const envSourcePath = path.join(REPO_PATH, '.env');
              const envDestPath = path.join(worktreePath, '.env');
              
              // Check if .env exists in main repo
              try {
                await fs.access(envSourcePath);
                await fs.copyFile(envSourcePath, envDestPath);
                console.log('✅ .env file copied to worktree');
              } catch (envError) {
                console.log('ℹ️ No .env file found in main repo to copy');
              }
              
              // Also copy .env.local if it exists
              try {
                const envLocalSourcePath = path.join(REPO_PATH, '.env.local');
                const envLocalDestPath = path.join(worktreePath, '.env.local');
                await fs.access(envLocalSourcePath);
                await fs.copyFile(envLocalSourcePath, envLocalDestPath);
                console.log('✅ .env.local file copied to worktree');
              } catch (envLocalError) {
                console.log('ℹ️ No .env.local file found in main repo to copy');
              }
            } catch (copyError) {
              console.log(`⚠️ Failed to copy environment files: ${copyError.message}`);
            }

            // Copy Claude Code configuration files for MCP server access
            try {
              // Copy .mcp.json file
              const mcpSourcePath = path.join(REPO_PATH, '.mcp.json');
              const mcpDestPath = path.join(worktreePath, '.mcp.json');
              
              try {
                await fs.access(mcpSourcePath);
                await fs.copyFile(mcpSourcePath, mcpDestPath);
                console.log('✅ .mcp.json file copied to worktree');
              } catch (mcpError) {
                console.log('ℹ️ No .mcp.json file found in main repo to copy');
              }
              
              // Copy .claude directory with settings
              try {
                const claudeDirSourcePath = path.join(REPO_PATH, '.claude');
                const claudeDirDestPath = path.join(worktreePath, '.claude');
                
                await fs.access(claudeDirSourcePath);
                await fs.cp(claudeDirSourcePath, claudeDirDestPath, { recursive: true });
                console.log('✅ .claude directory copied to worktree');
              } catch (claudeError) {
                console.log('ℹ️ No .claude directory found in main repo to copy');
              }
            } catch (claudeConfigError) {
              console.log(`⚠️ Failed to copy Claude configuration files: ${claudeConfigError.message}`);
            }
            
            resolve();
          } else {
            console.log('❌ Git worktree creation failed');
            console.log('Git stdout:', stdout);
            console.log('Git stderr:', stderr);
            console.log('Git exit code:', code);
            reject(new Error(`Git worktree creation failed with code ${code}: ${stderr}`));
          }
        });
      });
    } catch (error) {
      console.error('❌ Failed to create git worktree:', error);
      return;
    }
    
    // Update task status to "in progress" immediately
    try {
      console.log('Setting task status to "in progress"...');
      await updateClickUpTaskStatus(taskId, 'in progress');
      console.log('✅ Task status updated to "in progress"');
    } catch (error) {
      console.error('❌ Failed to update task status:', error);
      return; // Don't continue if we can't update status
    }
    
    const prompt = `You are working on ClickUp task "${taskName}" (ID: ${taskId}).

TASK DETAILS:
${taskDescription ? `Description: ${taskDescription}` : 'No description provided'}

${customFields.length > 0 ? `Custom Fields: ${JSON.stringify(customFields, null, 2)}` : 'No custom fields'}

INSTRUCTIONS:
1. The task status should be set to "in progress" - use the clickup mcp server to mark the task as "in progress"
2. Analyze the task description and custom fields to determine the task type (user issue, bug/fix, update/enhancement, new feature, or chore)  
3. Create a new branch using the template {clickup_id}/{task_type}/{descriptive_name} (branch will be created automatically)
4. Think carefully about your implementation approach considering the task type:
   - User issues: Focus on user experience and clear communication
   - Bug fixes: Prioritize root cause analysis and thorough testing  
   - Updates/Enhancements: Improve existing functionality while maintaining compatibility
   - New features: Design with scalability and integration in mind
   - Chores: Focus on code quality, maintenance, and developer experience

5. Implement the plan, then lint and build to check for errors
6. When complete, commit and push the changes, create a detailed PR targeting the main branch
7. Fill out the custom fields on the task for GitHub Pull Request URL and GitHub Branch using the ClickUp mcp server
8. Mark the task "Ready for Review (DEV) using the Clickup mcp server"

CRITICAL FINAL STEPS:
9. When implementation is complete and PR is created, add a PR comment with any manual steps required (database migrations, environment changes, etc.)
10. When completely done, print: "AUTOMATION_COMPLETE: Task ${taskId} implementation finished, PR created"

IMPORTANT: Always leave a PR comment if any manual steps are needed:
- Database migrations or schema changes
- Environment variable updates  
- Configuration file changes
- Package installations
- Build or deployment steps
- Any other manual intervention required

Begin implementation now!
`;

    const logFile = `automation_${taskId}_${Date.now()}.log`;
    const logPath = path.join(process.env.LOG_DIR || './logs', logFile);
    
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    
    const logStream = await fs.open(logPath, 'w');
    
    // Write prompt to temporary file to avoid argument length issues
    const tempPromptFile = path.join(process.env.LOG_DIR || './logs', `prompt_${taskId}_${Date.now()}.txt`);
    await fs.writeFile(tempPromptFile, prompt, 'utf8');
    
    const claudeArgs = [
      '-p', // print mode for headless operation
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--mcp-config', path.join(worktreePath, '.mcp.json')
    ];
    
    const fullCommand = `${CLAUDE_CODE_PATH} ${claudeArgs.map(arg => `"${arg}"`).join(' ')}`;
    console.log(`Executing Claude Code command: ${fullCommand}`);
    console.log(`Working directory: ${worktreePath}`);
    
    // Wrap Claude Code execution in Promise to properly await completion
    await new Promise((resolve, reject) => {
      const claudeCode = spawn(CLAUDE_CODE_PATH, claudeArgs, {
        cwd: worktreePath, // Run Claude Code in the worktree for this task
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          CLICKUP_API_KEY: process.env.CLICKUP_API_KEY,
          CLICKUP_TASK_ID: taskId,
        }
      });
      
      // Send prompt via stdin instead of command line argument
      claudeCode.stdin.write(prompt);
      claudeCode.stdin.end();

      // Add timeout mechanism to prevent infinite hanging
      const TIMEOUT_MINUTES = 10; // 10 minute timeout for Claude Code execution
      const timeoutId = setTimeout(async () => {
        await logProgress(`⚠️ Claude Code process timed out after ${TIMEOUT_MINUTES} minutes, terminating...`, true);
        claudeCode.kill('SIGTERM');
      
      // Force kill after 5 seconds if SIGTERM doesn't work
      setTimeout(async () => {
        if (!claudeCode.killed) {
          await logProgress('Force killing hung Claude Code process...', true);
          claudeCode.kill('SIGKILL');
        }
      }, 5000);
    }, TIMEOUT_MINUTES * 60 * 1000);

    let outputBuffer = '';
    let lastProgressUpdate = Date.now();
    let automationBranchName = branchName; // Store the branch name for later PR searches
    const logProgress = async (message, isError = false) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${isError ? 'ERROR' : 'INFO'}: ${message}\n`;
      console.log(isError ? `ERROR: ${message}` : message);
      try {
        // Check if log stream is still open before writing
        if (logStream && !logStream.closed) {
          await logStream.write(logEntry);
        }
      } catch (writeError) {
        // Ignore log write errors to prevent unhandled promise rejections
        console.log(`Log write failed: ${writeError.message}`);
      }
    };

    await logProgress(`Started automation for task ${taskId}: ${taskName}`);
    await logProgress(`Command: ${fullCommand}`);
    await logProgress(`Working directory: ${worktreePath}`);
    await logProgress(`Original repo: ${REPO_PATH}`);

    claudeCode.stdout.on('data', async (data) => {
      const output = data.toString();
      outputBuffer += output;
      
      // Log progress every 30 seconds or when we see JSON output
      const now = Date.now();
      if (now - lastProgressUpdate > 30000 || output.includes('"type":"result"')) {
        await logProgress(`Claude Code output received (${outputBuffer.length} chars total)`);
        lastProgressUpdate = now;
      }
      
      // Check for completion message
      if (output.includes(`AUTOMATION_COMPLETE: Task ${taskId} implementation finished`)) {
        await logProgress('🎉 TEXT-BASED: Automation completion message detected!');
        
        // Trigger final completion steps using new function
        await handleAutomationCompletion(taskId, automationBranchName, worktreePath, output);
        return; // Exit early since completion was detected
        
        // OLD IMPLEMENTATION BELOW - KEEPING AS BACKUP
        try {
          // Get PR details first
          const getPRDetails = spawn('gh', ['pr', 'list', '--head', automationBranchName, '--state', 'open', '--json', 'url,headRefName,createdAt', '--limit', '1'], {
            cwd: REPO_PATH  // Use original repo for gh commands
          });
          
          let prDetailsOutput = '';
          getPRDetails.stdout.on('data', (data) => prDetailsOutput += data.toString());
          
          getPRDetails.on('close', async (detailsCode) => {
            if (detailsCode === 0 && prDetailsOutput.trim()) {
              try {
                const prDetails = JSON.parse(prDetailsOutput);
                if (prDetails.length > 0) {
                  const prUrl = prDetails[0].url;
                  const branchName = prDetails[0].headRefName;
                  
                  await logProgress(`Updating custom fields - Branch: ${branchName}, PR: ${prUrl}`);
                  
                  // Update GitHub Branch custom field
                  try {
                    await setClickUpCustomField(taskId, 'GitHub Branch', branchName);
                    await logProgress('✅ GitHub Branch field updated');
                  } catch (error) {
                    await logProgress(`⚠️ Failed to update GitHub Branch: ${error.message}`, true);
                  }
                  
                  // Update GitHub Pull Request URL custom field  
                  try {
                    await setClickUpCustomField(taskId, 'GitHub Pull Request URL', prUrl);
                    await logProgress('✅ GitHub Pull Request URL field updated');
                  } catch (error) {
                    await logProgress(`⚠️ Failed to update GitHub Pull Request URL: ${error.message}`, true);
                  }
                }
              } catch (parseError) {
                await logProgress(`⚠️ Failed to parse PR details: ${parseError.message}`, true);
              }
            }
            
            // Update final task status
            try {
              await logProgress('Setting final task status to "ready for review (dev)"...');
              await updateClickUpTaskStatus(taskId, 'ready for review (dev)');
              await logProgress('✅ Task status updated to "ready for review (dev)"');
            } catch (error) {
              await logProgress(`❌ Failed to update final task status: ${error.message}`, true);
            }
          });
        } catch (error) {
          await logProgress(`❌ Failed to get PR details for completion: ${error.message}`, true);
        }
      }
      
      // Parse JSON output to extract completion status
      try {
        const lines = outputBuffer.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{') && line.includes('"type":"result"')) {
            const result = JSON.parse(line.trim());
            if (result.type === 'result') {
              await logProgress('📊 === CLAUDE CODE EXECUTION STATS ===');
              await logProgress(`🎯 Status: ${result.subtype}`);
              await logProgress(`⏱️ Duration: ${result.duration_ms}ms (API: ${result.duration_api_ms}ms)`);
              await logProgress(`💰 Cost: $${result.total_cost_usd}`);
              await logProgress(`🔄 Turns: ${result.num_turns}`);
              await logProgress(`⚠️ Errors: ${result.is_error}`);
              if (result.permission_denials?.length > 0) {
                await logProgress(`🚫 Permission Denials: ${result.permission_denials.length}`);
              }
              if (result.usage) {
                await logProgress(`📄 Input Tokens: ${result.usage.input_tokens || 0} (Cache: ${result.usage.cache_read_input_tokens || 0})`);
                await logProgress(`📝 Output Tokens: ${result.usage.output_tokens || 0}`);
              }
              await logProgress('📊 =====================================');
              
              // Check if task was completed successfully
              if (result.subtype === 'success' && !result.is_error) {
                await logProgress('🎉 JSON SUCCESS: Automation completed successfully!');
                
                // Check if the result contains automation complete marker
                if (result.result && result.result.includes('AUTOMATION_COMPLETE:')) {
                  await logProgress('✅ Automation completion marker found in result!');
                  
                  // Trigger final completion steps
                  await handleAutomationCompletion(taskId, automationBranchName, worktreePath, result.result);
                  return; // Exit early since we detected completion via JSON
                } else {
                  await logProgress('⚠️ Success detected but no AUTOMATION_COMPLETE marker found');
                }
              } else {
                await logProgress(`⚠️ WARNING: Automation completed with status: ${result.subtype}, is_error: ${result.is_error}`);
              }
            }
          }
        }
      } catch (e) {
        // Ignore JSON parsing errors for partial output
      }
      
      await logStream.write(`[STDOUT] ${output}`);
    });

    claudeCode.stderr.on('data', async (data) => {
      const error = data.toString();
      await logProgress(`Claude Code Error: ${error}`, true);
      await logStream.write(`[STDERR] ${error}\n`);
    });

      claudeCode.on('close', async (code) => {
        clearTimeout(timeoutId); // Clear timeout since process completed
        await logProgress(`Claude Code process exited with code ${code}`);
        await logStream.write(`\n[COMPLETE] Process exited with code ${code}\n`);
        
        // Check if process completed successfully but didn't print completion message
        // This handles cases where Claude Code finishes work but gets killed before final message
        if (code === 143 || code === null || code === 0) { // 143 = SIGTERM, null = killed, 0 = success
        await logProgress('Process completed, checking if work was finished...');
        
        // Wait a moment for any final git operations to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if PR was created as indicator of successful completion (with retries)
        let prFound = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await logProgress(`Attempting PR check ${attempt}/3...`);
            const checkPR = spawn('gh', ['pr', 'list', '--head', automationBranchName, '--state', 'open', '--json', 'number,createdAt', '--limit', '1'], {
              cwd: REPO_PATH  // Use original repo for gh commands
            });
            
            let prOutput = '';
            checkPR.stdout.on('data', (data) => prOutput += data.toString());
            
            await new Promise((resolve) => {
              checkPR.on('close', async (prCode) => {
                if (prCode === 0 && prOutput.includes('"number":')) {
                  // Check if PR was created in last 10 minutes (current automation)
                  const prData = JSON.parse(prOutput);
                  if (prData.length > 0) {
                    const createdAt = new Date(prData[0].createdAt);
                    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
                    if (createdAt > tenMinutesAgo) {
                      prFound = true;
                    } else {
                      await logProgress(`PR found but created ${Math.round((Date.now() - createdAt.getTime()) / 60000)} minutes ago, not from current automation`);
                    }
                  }
                }
                resolve();
              });
            });
            
            if (prFound) {
              await logProgress('✅ PR found! Proceeding with completion steps...');
              break;
            } else {
              await logProgress(`Attempt ${attempt}/3: No PR found yet, waiting...`);
              if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s between attempts
              }
            }
          } catch (error) {
            await logProgress(`PR check attempt ${attempt} failed: ${error.message}`, true);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }
        
        if (prFound) {
              await logProgress('✅ PR was created successfully, treating as completion');
              await logProgress('🎉 PR-BASED: Automation completion detected via PR check!');
              
              // Trigger final completion steps using new function
              await handleAutomationCompletion(taskId, automationBranchName, worktreePath);
              return; // Exit early since completion was detected
              
              // OLD IMPLEMENTATION BELOW - KEEPING AS BACKUP
              try {
                // Get most recent PR created in last 5 minutes for this task
                const getPRDetails = spawn('gh', ['pr', 'list', '--head', automationBranchName, '--state', 'open', '--json', 'url,headRefName,createdAt', '--limit', '1'], {
                  cwd: REPO_PATH  // Use original repo for gh commands
                });
                
                let prDetailsOutput = '';
                getPRDetails.stdout.on('data', (data) => prDetailsOutput += data.toString());
                
                getPRDetails.on('close', async (detailsCode) => {
                  if (detailsCode === 0 && prDetailsOutput.trim()) {
                    try {
                      const prDetails = JSON.parse(prDetailsOutput);
                      // Only use PR if created in last 10 minutes
                      if (prDetails.length > 0) {
                        const createdAt = new Date(prDetails[0].createdAt);
                        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
                        if (createdAt < tenMinutesAgo) {
                          await logProgress('Found PR is too old, not from current automation');
                          return;
                        }
                      }
                      if (prDetails.length > 0) {
                        const prUrl = prDetails[0].url;
                        const branchName = prDetails[0].headRefName;
                        
                        await logProgress(`Updating custom fields - Branch: ${branchName}, PR: ${prUrl}`);
                        
                        // Update GitHub Branch custom field
                        try {
                          await setClickUpCustomField(taskId, 'GitHub Branch', branchName);
                          await logProgress('✅ GitHub Branch field updated');
                        } catch (error) {
                          await logProgress(`⚠️ Failed to update GitHub Branch: ${error.message}`, true);
                        }
                        
                        // Update GitHub Pull Request URL custom field  
                        try {
                          await setClickUpCustomField(taskId, 'GitHub Pull Request URL', prUrl);
                          await logProgress('✅ GitHub Pull Request URL field updated');
                        } catch (error) {
                          await logProgress(`⚠️ Failed to update GitHub Pull Request URL: ${error.message}`, true);
                        }
                      }
                    } catch (parseError) {
                      await logProgress(`⚠️ Failed to parse PR details: ${parseError.message}`, true);
                    }
                  }
                  
                  // Update final task status
                  try {
                    await logProgress('Setting final task status to "ready for review (dev)"...');
                    await updateClickUpTaskStatus(taskId, 'ready for review (dev)');
                    await logProgress('✅ Task status updated to "ready for review (dev)"');
                  } catch (error) {
                    await logProgress(`❌ Failed to update final task status: ${error.message}`, true);
                  }
                });
              } catch (error) {
                await logProgress(`❌ Failed to get PR details: ${error.message}`, true);
              }
        } else {
          await logProgress('❌ No PR was found after 3 attempts. Work may not have completed successfully.', true);
        }
      }
      
      // Analyze final output for success indicators
      if (code === 0 && outputBuffer.includes('"subtype":"success"')) {
        await logProgress(`✅ Task ${taskId} completed successfully`);
        
        // Verify PR was created and task status updated
        if (outputBuffer.includes('PR #') || outputBuffer.includes('pull/')) {
          await logProgress('✅ Pull request created successfully');
        } else {
          await logProgress('⚠️  No PR creation detected in output', true);
        }
        
        // Server handles all ClickUp updates - get PR details and update task
        try {
          const getPRDetails = spawn('gh', ['pr', 'list', '--head', automationBranchName, '--state', 'open', '--json', 'url,headRefName,createdAt', '--limit', '1'], {
            cwd: REPO_PATH
          });
          
          let prDetailsOutput = '';
          getPRDetails.stdout.on('data', (data) => prDetailsOutput += data.toString());
          
          getPRDetails.on('close', async (detailsCode) => {
            if (detailsCode === 0 && prDetailsOutput.trim()) {
              try {
                const prDetails = JSON.parse(prDetailsOutput);
                if (prDetails.length > 0) {
                  const prUrl = prDetails[0].url;
                  const branchName = prDetails[0].headRefName;
                  
                  await logProgress(`Updating custom fields - Branch: ${branchName}, PR: ${prUrl}`);
                  
                  // Update GitHub Branch custom field
                  try {
                    await setClickUpCustomField(taskId, 'GitHub Branch', branchName);
                    await logProgress('✅ GitHub Branch field updated');
                  } catch (error) {
                    await logProgress(`⚠️ Failed to update GitHub Branch: ${error.message}`, true);
                  }
                  
                  // Update GitHub Pull Request URL custom field  
                  try {
                    await setClickUpCustomField(taskId, 'GitHub Pull Request URL', prUrl);
                    await logProgress('✅ GitHub Pull Request URL field updated');
                  } catch (error) {
                    await logProgress(`⚠️ Failed to update GitHub Pull Request URL: ${error.message}`, true);
                  }
                  
                  // Set final task status to "ready for review (dev)"
                  try {
                    await logProgress('Setting final task status to "ready for review (dev)"...');
                    await updateClickUpTaskStatus(taskId, 'ready for review (dev)');
                    await logProgress('✅ Task status updated to "ready for review (dev)"');
                  } catch (error) {
                    await logProgress(`❌ Failed to update final task status: ${error.message}`, true);
                  }
                }
              } catch (parseError) {
                await logProgress(`⚠️ Failed to parse PR details: ${parseError.message}`, true);
              }
            } else {
              await logProgress('⚠️ Could not get PR details for final updates', true);
            }
          });
        } catch (error) {
          await logProgress(`❌ Failed to get PR details: ${error.message}`, true);
        }
        
        // Extract and post manual steps as ClickUp comment
        try {
          const manualStepsRegex = /### ⚠️ Manual Steps Required\n\n(.*?)(?=\n\n###|\n\nThe implementation|$)/s;
          const match = outputBuffer.match(manualStepsRegex);
          
          if (match && match[1]) {
            const manualSteps = match[1].trim();
            await logProgress(`Found manual steps: ${manualSteps.substring(0, 100)}...`);
            
            const commentText = `🤖 **Automation Complete** - Manual steps required:\n\n${manualSteps}`;
            
            // Post comment to ClickUp task
            const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
              method: 'POST',
              headers: {
                'Authorization': CLICKUP_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                comment_text: commentText
              })
            });
            
            if (response.ok) {
              await logProgress('✅ Manual steps posted as ClickUp comment');
            } else {
              await logProgress(`⚠️ Failed to post comment: ${response.status} ${response.statusText}`, true);
            }
          } else {
            await logProgress('ℹ️ No manual steps found in automation output');
          }
        } catch (error) {
          await logProgress(`⚠️ Failed to extract/post manual steps: ${error.message}`, true);
        }
        
      } else if (code !== 143 && code !== null) {
        await logProgress(`❌ Task ${taskId} failed with exit code ${code}`, true);
      }
      
      // Cleanup worktree after completion
      try {
        await logProgress('Cleaning up git worktree...');
        const removeWorktree = spawn('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: REPO_PATH
        });
        
        await new Promise((resolve) => {
          removeWorktree.on('close', async (removeCode) => {
            if (removeCode === 0) {
              await logProgress('✅ Git worktree cleaned up successfully');
            } else {
              await logProgress(`⚠️ Git worktree cleanup failed with code ${removeCode}`, true);
            }
            resolve();
          });
        });
      } catch (cleanupError) {
        await logProgress(`⚠️ Worktree cleanup error: ${cleanupError.message}`, true);
      }
      
        await logStream.close();
        console.log(`📋 Full log available at: ${logPath}`);
        
        // Resolve the Promise to indicate Claude Code execution is complete
        resolve(code);
      });
    });

    
    await logProgress('✅ Claude Code execution completed and all automation steps finished!');
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