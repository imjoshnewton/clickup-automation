#!/usr/bin/env tsx
import express from "express";
import crypto from "crypto";
import https from "https";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { query } from "@anthropic-ai/claude-code";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const REPO_PATH = process.env.REPO_PATH || "/path/to/your/repo";
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? process.env.ALLOWED_IPS.split(",")
  : [];
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Claude Code SDK will be used in processTaskWithSDK function

app.use(express.json());
app.use(express.raw({ type: "application/json" }));

function verifyClickUpSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
}

function ipWhitelistMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (ALLOWED_IPS.length === 0) {
    return next();
  }

  const clientIP =
    req.ip || req.connection.remoteAddress || req.socket.remoteAddress || "";
  if (ALLOWED_IPS.includes(clientIP)) {
    return next();
  }

  console.log(`Blocked request from IP: ${clientIP}`);
  return res.status(403).json({ error: "Forbidden" });
}

// Handle both /webhook/clickup and /webhook/clickup/:taskId
app.post(
  ["/webhook/clickup", "/webhook/clickup/:taskId"],
  ipWhitelistMiddleware,
  async (req, res) => {
    try {
      console.log("🚀 TypeScript webhook endpoint hit!");

      const payload = req.body;
      const signature = req.headers["x-signature"] as string;

      console.log("Received signature:", signature);
      console.log("Expected signature:", CLICKUP_WEBHOOK_SECRET);

      if (CLICKUP_WEBHOOK_SECRET) {
        // Simple token comparison - ClickUp sends the secret directly, not as HMAC
        if (!signature || signature !== CLICKUP_WEBHOOK_SECRET) {
          console.log("❌ Invalid webhook signature");
          console.log("Received:", signature);
          console.log("Expected:", CLICKUP_WEBHOOK_SECRET);
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      console.log("✅ Authentication passed");

      let body;
      try {
        body = typeof payload === "string" ? JSON.parse(payload) : payload;
      } catch (parseError) {
        console.error("❌ JSON parse error:", parseError);
        return res.status(400).json({ error: "Invalid JSON" });
      }

      // Log the entire payload to see what ClickUp sends
      console.log("📦 ClickUp payload:", JSON.stringify(body, null, 2));

      // Check if this is a test webhook from ClickUp
      if (body.body === "Test message from ClickUp Webhooks Service") {
        console.log("✅ Received test webhook from ClickUp");
        return res
          .status(200)
          .json({ success: true, message: "Test webhook received" });
      }

      // Get task_id from URL params first, then fall back to body
      const task_id =
        req.params.taskId ||
        body.task_id ||
        body.id ||
        (body.task && body.task.id);
      const event = body.event || body.history_items?.[0]?.field || "unknown";

      console.log("🔍 Extracted task_id:", task_id);
      console.log("🔍 Extracted event:", event);

      // Log if we got the ID from URL
      if (req.params.taskId) {
        console.log(`📍 Task ID from URL: ${req.params.taskId}`);
      }

      if (!task_id) {
        console.log("❌ No task_id found in payload:", body);
        return res.status(400).json({ error: "No task_id provided" });
      }

      console.log(
        `📨 Received ClickUp webhook for task ${task_id}, event: ${event}`,
      );

      // Simple success response for ClickUp
      res.status(200).json({ success: true });

      console.log("✅ Webhook response sent, starting task processing...");

      // Process task asynchronously so we don't block the response
      setImmediate(() => {
        processTask(task_id, body).catch((error) => {
          console.error("❌ Task processing error:", error);
        });
      });
    } catch (error: any) {
      console.error("❌ Webhook error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  custom_fields?: Array<{
    id: string;
    name: string;
    value?: any;
  }>;
}

async function updateClickUpTaskStatus(
  taskId: string,
  status: string,
): Promise<any> {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;
  const data = JSON.stringify({ status });

  return new Promise((resolve, reject) => {
    const options = {
      method: "PUT",
      headers: {
        Authorization: CLICKUP_API_KEY,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(url, options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getClickUpTask(taskId: string): Promise<ClickUpTask> {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;

  return new Promise((resolve, reject) => {
    const options = {
      method: "GET",
      headers: {
        Authorization: CLICKUP_API_KEY,
      },
    };

    const req = https.request(url, options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function setClickUpCustomField(
  taskId: string,
  fieldName: string,
  value: any,
): Promise<any> {
  // First get the task to find the custom field ID
  const task = await getClickUpTask(taskId);
  const customField = task.custom_fields?.find(
    (field) => field.name === fieldName,
  );

  if (!customField) {
    throw new Error(`Custom field "${fieldName}" not found`);
  }

  const url = `https://api.clickup.com/api/v2/task/${taskId}/field/${customField.id}`;
  const data = JSON.stringify({ value });

  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        Authorization: CLICKUP_API_KEY,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(url, options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData ? JSON.parse(responseData) : {});
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function handleAutomationCompletion(
  taskId: string,
  automationBranchName: string,
  worktreePath: string,
): Promise<void> {
  const logProgress = (msg: string, err = false) =>
    console.log(`${new Date().toISOString()}: ${msg}`);

  try {
    await logProgress("🎯 Starting automation completion steps...");

    // Get PR details first
    const getPRDetails = spawn(
      "gh",
      [
        "pr",
        "list",
        "--head",
        automationBranchName,
        "--state",
        "open",
        "--json",
        "url,headRefName,createdAt",
        "--limit",
        "1",
      ],
      {
        cwd: REPO_PATH,
      },
    );

    let prDetailsOutput = "";
    getPRDetails.stdout.on(
      "data",
      (data) => (prDetailsOutput += data.toString()),
    );

    await new Promise<void>((resolve) => {
      getPRDetails.on("close", async (detailsCode) => {
        if (detailsCode === 0 && prDetailsOutput.trim()) {
          try {
            const prDetails = JSON.parse(prDetailsOutput);
            // Only use PR if created in last 10 minutes
            if (prDetails.length > 0) {
              const createdAt = new Date(prDetails[0].createdAt);
              const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
              if (createdAt < tenMinutesAgo) {
                await logProgress(
                  "Found PR is too old, not from current automation",
                );
                resolve();
                return;
              }
              const prUrl = prDetails[0].url;
              const branchName = prDetails[0].headRefName;

              await logProgress(
                `Updating custom fields - Branch: ${branchName}, PR: ${prUrl}`,
              );

              // Update GitHub Branch custom field
              try {
                await setClickUpCustomField(
                  taskId,
                  "GitHub Branch",
                  branchName,
                );
                await logProgress("✅ GitHub Branch field updated");
              } catch (error: any) {
                await logProgress(
                  `⚠️ Failed to update GitHub Branch: ${error.message}`,
                );
              }

              // Update GitHub Pull Request URL custom field
              try {
                await setClickUpCustomField(
                  taskId,
                  "GitHub Pull Request URL",
                  prUrl,
                );
                await logProgress("✅ GitHub Pull Request URL field updated");
              } catch (error: any) {
                await logProgress(
                  `⚠️ Failed to update GitHub Pull Request URL: ${error.message}`,
                );
              }

              // Update task status to "Ready for Review (DEV)"
              try {
                await updateClickUpTaskStatus(taskId, "Ready for Review (DEV)");
                await logProgress(
                  '✅ Task status updated to "Ready for Review (DEV)"',
                );
              } catch (error: any) {
                await logProgress(
                  `⚠️ Failed to update task status: ${error.message}`,
                );
              }

              await logProgress("🎉 All automation completion steps finished!");
            }
          } catch (parseError: any) {
            await logProgress(
              `⚠️ Failed to parse PR details: ${parseError.message}`,
            );
          }
        } else {
          await logProgress("No PR found for completion handling");
        }

        // Cleanup worktree after completion
        try {
          await logProgress("Cleaning up git worktree...");
          const removeWorktree = spawn(
            "git",
            ["worktree", "remove", "--force", worktreePath],
            {
              cwd: REPO_PATH,
            },
          );

          await new Promise<void>((resolve) => {
            removeWorktree.on("close", async (removeCode) => {
              if (removeCode === 0) {
                await logProgress("✅ Git worktree cleaned up successfully");
              } else {
                await logProgress(
                  `⚠️ Git worktree cleanup failed with code ${removeCode}`,
                );
              }
              resolve();
            });
          });
        } catch (cleanupError: any) {
          await logProgress(
            `⚠️ Worktree cleanup error: ${cleanupError.message}`,
          );
        }

        resolve();
      });
    });
  } catch (error: any) {
    await logProgress(`⚠️ Automation completion error: ${error.message}`);
  }
}

async function processTaskWithSDK(
  taskId: string,
  taskData: ClickUpTask,
): Promise<void> {
  const taskName = taskData.name || taskId;
  const taskDescription = taskData.description || taskData.text_content || "";
  const customFields = taskData.custom_fields || [];

  console.log(`Task: ${taskName}`);
  console.log(`Description preview: ${taskDescription.substring(0, 100)}...`);

  // Create git worktree for this task
  const worktreePath = path.join(
    process.env.WORKTREE_BASE_DIR || "/tmp/claude-automation",
    `task-${taskId}`,
  );

  try {
    console.log(`Creating git worktree at: ${worktreePath}`);

    // Remove existing worktree if it exists
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch (e) {
      /* ignore if doesn't exist */
    }

    // Ensure base directory exists
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    // Determine task type from task name and description
    const taskNameLower = taskName.toLowerCase();
    const taskDescLower = taskDescription?.toLowerCase() || "";

    let taskType = "feature"; // default
    if (
      taskNameLower.includes("fix") ||
      taskNameLower.includes("bug") ||
      taskDescLower.includes("fix") ||
      taskDescLower.includes("bug")
    ) {
      taskType = "fix";
    } else if (
      taskNameLower.includes("update") ||
      taskNameLower.includes("enhance") ||
      taskNameLower.includes("improve") ||
      taskNameLower.includes("change")
    ) {
      taskType = "update";
    } else if (
      taskNameLower.includes("chore") ||
      taskNameLower.includes("refactor") ||
      taskNameLower.includes("cleanup")
    ) {
      taskType = "chore";
    }

    // Create descriptive name from task name
    const descriptiveName = taskName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
      .replace(/\s+/g, "-") // Replace spaces with dashes
      .replace(/-+/g, "-") // Replace multiple dashes with single dash
      .slice(0, 50); // Limit length

    const branchName = `${taskId}/${taskType}/${descriptiveName}`;

    // Clean up any existing branch and worktree
    try {
      // Remove existing worktree if it exists
      const removeWorktree = spawn(
        "git",
        ["worktree", "remove", "--force", worktreePath],
        { cwd: REPO_PATH },
      );
      await new Promise<void>((resolve) => {
        removeWorktree.on("close", () => resolve()); // Don't reject on failure
      });

      // Delete existing branch if it exists
      const deleteBranch = spawn("git", ["branch", "-D", branchName], {
        cwd: REPO_PATH,
      });
      await new Promise<void>((resolve) => {
        deleteBranch.on("close", () => resolve()); // Don't reject on failure
      });
    } catch (e) {
      /* ignore cleanup failures */
    }

    const createWorktree = spawn(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, "origin/main"],
      {
        cwd: REPO_PATH,
      },
    );

    let stderr = "";
    let stdout = "";

    createWorktree.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    createWorktree.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      createWorktree.on("close", async (code) => {
        if (code === 0) {
          console.log("✅ Git worktree created successfully");
          console.log("Git stdout:", stdout);

          // Copy configuration files
          await copyConfigurationFiles(worktreePath);

          resolve();
        } else {
          console.log("❌ Git worktree creation failed");
          console.log("Git stdout:", stdout);
          console.log("Git stderr:", stderr);
          console.log("Git exit code:", code);
          reject(
            new Error(
              `Git worktree creation failed with code ${code}: ${stderr}`,
            ),
          );
        }
      });
    });

    // Claude Code SDK will handle setting task status to "in progress" via MCP

    // Use Claude Code SDK
    const prompt = buildTaskPrompt(
      taskId,
      taskName,
      taskDescription,
      customFields,
    );

    console.log("🤖 Starting Claude Code SDK processing...");

    const logFile = `automation_${taskId}_${Date.now()}.log`;
    const logPath = path.join(process.env.LOG_DIR || "./logs", logFile);

    await fs.mkdir(path.dirname(logPath), { recursive: true });
    let logStream: any = null;
    
    // Initialize log stream with error handling
    try {
      logStream = await fs.open(logPath, "w");
    } catch (logOpenError: any) {
      console.log(`Failed to open log file: ${logOpenError.message}`);
    }

    const logProgress = async (message: string, isError = false) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${isError ? "ERROR" : "INFO"}: ${message}\n`;
      console.log(isError ? `ERROR: ${message}` : message);
      
      // Try to write to log file, but don't fail if it doesn't work
      if (logStream) {
        try {
          await logStream.write(logEntry);
          // Force flush to disk
          await logStream.sync();
        } catch (writeError: any) {
          console.log(`Log write failed: ${writeError.message}`);
          // Try to reopen the log stream
          try {
            if (logStream) {
              await logStream.close();
            }
            logStream = await fs.open(logPath, "a"); // Append mode
          } catch (reopenError: any) {
            console.log(`Log reopen failed: ${reopenError.message}`);
            logStream = null; // Give up on file logging
          }
        }
      }
    };

    await logProgress(`Started SDK automation for task ${taskId}: ${taskName}`);
    await logProgress(`Working directory: ${worktreePath}`);

    try {
      await logProgress("🤖 Creating Anthropic SDK conversation...");

      // Run Claude Code SDK - this handles all the tool calling automatically
      const messages: any[] = [];

      // Change to the worktree directory before running Claude Code
      process.chdir(worktreePath);

      // Set up timeout for Claude Code SDK query - increased to 15 minutes for complex tasks
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Claude Code SDK query timeout after 15 minutes")), 15 * 60 * 1000);
      });

      const queryPromise = (async () => {
        for await (const msg of query({
          prompt,
          options: {
            allowedTools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "mcp__clickup__get_task", "mcp__clickup__update_task_status"],
          },
        })) {
        messages.push(msg);

        // Log progress messages
        if (msg.type === "assistant") {
          await logProgress(`💬 Claude response received`);
        } else if (msg.type === "user") {
          await logProgress(`🔧 Tool execution`);
        } else if (msg.type === "system") {
          await logProgress(`⚙️ System: ${msg.subtype}`);
        }
        }
        return messages;
      })();

      // Race between the query and timeout
      try {
        await Promise.race([queryPromise, timeoutPromise]);
        
        const result = messages.find((m) => m.type === "result");
        if (result) {
          if (result.subtype === "success") {
            await logProgress(`✅ SDK conversation completed successfully`);
            await logProgress(
              `Response: ${(result as any).result?.substring(0, 100)}...`,
            );
            await logProgress("🎉 Task automation completed via Claude Code SDK!");
            
            // Clean up the worktree after successful completion
            await cleanupWorktree(worktreePath);
          } else {
            await logProgress(
              `⚠️ SDK conversation failed: ${result.subtype}`,
              true,
            );
          }
        } else {
          await logProgress("⚠️ No result message received from SDK", true);
        }
      } catch (timeoutError: any) {
        if (timeoutError.message.includes("timeout")) {
          await logProgress(`⏰ Claude Code SDK timed out after 15 minutes`, true);
          await logProgress(`📊 Messages processed: ${messages.length}`, false);
          
          // Log the last few messages to understand where it got stuck
          const lastMessages = messages.slice(-5);
          await logProgress(`🔍 Last ${lastMessages.length} messages:`, false);
          for (const msg of lastMessages) {
            await logProgress(`  - ${msg.type}: ${msg.subtype || 'no subtype'}`, false);
          }
          
          await logProgress(`⚠️ Task may have been partially completed - check git status`, false);
        } else {
          // Re-throw non-timeout errors
          throw timeoutError;
        }
      }
    } catch (error: any) {
      await logProgress(`❌ SDK automation failed: ${error.message}`, true);
      await logProgress(`❌ Stack trace: ${error.stack}`, true);
    } finally {
      // Ensure log stream is properly closed
      if (logStream) {
        try {
          await logProgress("🏁 Closing automation log file...");
          await logStream.sync(); // Flush any remaining data
          await logStream.close();
        } catch (closeError: any) {
          console.log(`Log close failed: ${closeError.message}`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Failed to process task with SDK:", error);
  }
}

async function copyConfigurationFiles(worktreePath: string): Promise<void> {
  // Copy .env file to worktree for database connections and testing
  try {
    const envSourcePath = path.join(REPO_PATH, ".env");
    const envDestPath = path.join(worktreePath, ".env");

    try {
      await fs.access(envSourcePath);
      await fs.copyFile(envSourcePath, envDestPath);
      console.log("✅ .env file copied to worktree");
    } catch (envError) {
      console.log("ℹ️ No .env file found in main repo to copy");
    }

    // Also copy .env.local if it exists
    try {
      const envLocalSourcePath = path.join(REPO_PATH, ".env.local");
      const envLocalDestPath = path.join(worktreePath, ".env.local");
      await fs.access(envLocalSourcePath);
      await fs.copyFile(envLocalSourcePath, envLocalDestPath);
      console.log("✅ .env.local file copied to worktree");
    } catch (envLocalError) {
      console.log("ℹ️ No .env.local file found in main repo to copy");
    }
  } catch (copyError: any) {
    console.log(`⚠️ Failed to copy environment files: ${copyError.message}`);
  }

  // Copy Claude Code configuration files for MCP server access
  try {
    // Copy .mcp.json file
    const mcpSourcePath = path.join(REPO_PATH, ".mcp.json");
    const mcpDestPath = path.join(worktreePath, ".mcp.json");

    try {
      await fs.access(mcpSourcePath);
      await fs.copyFile(mcpSourcePath, mcpDestPath);
      console.log("✅ .mcp.json file copied to worktree");
    } catch (mcpError) {
      console.log("ℹ️ No .mcp.json file found in main repo to copy");
    }

    // Copy .claude directory with settings
    try {
      const claudeDirSourcePath = path.join(REPO_PATH, ".claude");
      const claudeDirDestPath = path.join(worktreePath, ".claude");

      await fs.access(claudeDirSourcePath);
      await fs.cp(claudeDirSourcePath, claudeDirDestPath, { recursive: true });
      console.log("✅ .claude directory copied to worktree");
    } catch (claudeError) {
      console.log("ℹ️ No .claude directory found in main repo to copy");
    }
  } catch (claudeConfigError: any) {
    console.log(
      `⚠️ Failed to copy Claude configuration files: ${claudeConfigError.message}`,
    );
  }
}

// Tool execution functions
async function executeBashCommand(
  command: string,
  workingDirectory: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const process = spawn("bash", ["-c", command], {
      cwd: workingDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("close", (code: number) => {
      const result = {
        command,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
      resolve(JSON.stringify(result, null, 2));
    });

    process.on("error", (error: Error) => {
      reject(error);
    });
  });
}

async function createFile(
  filePath: string,
  content: string,
  workingDirectory: string,
): Promise<string> {
  const fullPath = path.join(workingDirectory, filePath);

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Write file
  await fs.writeFile(fullPath, content, "utf8");

  return `File created successfully at ${filePath}`;
}

async function readFile(
  filePath: string,
  workingDirectory: string,
): Promise<string> {
  const fullPath = path.join(workingDirectory, filePath);

  try {
    const content = await fs.readFile(fullPath, "utf8");
    return content;
  } catch (error: any) {
    return `Error reading file: ${error.message}`;
  }
}

async function executeClickUpUpdate(
  taskId: string,
  input: any,
): Promise<string> {
  try {
    if (input.action === "set_status") {
      await updateClickUpTaskStatus(taskId, input.status);
      return `Task status updated to: ${input.status}`;
    } else if (input.action === "set_custom_field") {
      await setClickUpCustomField(taskId, input.field_name, input.field_value);
      return `Custom field ${input.field_name} set to: ${input.field_value}`;
    } else {
      return `Unknown action: ${input.action}`;
    }
  } catch (error: any) {
    return `Error updating ClickUp: ${error.message}`;
  }
}

function buildTaskPrompt(
  taskId: string,
  taskName: string,
  taskDescription: string,
  customFields: any[],
): string {
  // Check if this is a test case
  if (taskId.toLowerCase().includes('test')) {
    return `This is a test automation task "${taskName}" (ID: ${taskId}).

TASK DETAILS:
${taskDescription ? `Description: ${taskDescription}` : "No description provided"}

TEST AUTOMATION INSTRUCTIONS:
You are testing the automation infrastructure. Use these tools to:

1. Create a test file named "${taskId}.txt" with some sample content (date, task info, etc.)
2. Make a simple commit with message "test: Add test file for automation validation (${taskId})"
3. Push the changes to the test branch (already created)
4. Create a PR targeting main branch with title "Test Automation: ${taskId}"
5. When done, include in your final response: "TEST_AUTOMATION_COMPLETE: Task ${taskId} test finished, PR created"

Do NOT use any ClickUp MCP tools since this is just testing the automation infrastructure.

This is a test - keep it simple and focus on testing the automation workflow!
`;
  }

  return `You are working on ClickUp task "${taskName}" (ID: ${taskId}).

TASK DETAILS:
${taskDescription ? `Description: ${taskDescription}` : "No description provided"}

${customFields.length > 0 ? `Custom Fields: ${JSON.stringify(customFields, null, 2)}` : "No custom fields"}

INSTRUCTIONS:
You have access to tools to execute bash commands, create/read files, and update the ClickUp task via MCP. Use these tools to:

1. Set the task status to "in progress" using mcp__clickup__update_task_status
2. Analyze the task description to determine the task type (user issue, bug/fix, update/enhancement, new feature, or chore)
3. The git branch has already been created using the pattern {clickup_id}/{task_type}/{descriptive_name}
4. Think carefully about your implementation approach considering the task type:
   - User issues: Focus on user experience and clear communication
   - Bug fixes: Prioritize root cause analysis and thorough testing  
   - Updates/Enhancements: Improve existing functionality while maintaining compatibility
   - New features: Design with scalability and integration in mind
   - Chores: Focus on code quality, maintenance, and developer experience

5. Implement the plan using the available tools, then lint and build to check for errors
6. When complete, commit and push the changes, create a detailed PR targeting the main branch using bash commands
7. Fill out the custom fields on the task using MCP tools:
   - Use mcp__clickup__set_custom_field_value_by_name to set "GitHub Branch" to the branch name
   - Use mcp__clickup__set_custom_field_value_by_name to set "GitHub Pull Request URL" to the PR URL
8. Mark the task "Ready for Review (DEV)" using mcp__clickup__update_task_status

CRITICAL FINAL STEPS:
9. When implementation is complete and PR is created, add a PR comment with any manual steps required (database migrations, environment changes, etc.)
10. When completely done, include in your final response: "AUTOMATION_COMPLETE: Task ${taskId} implementation finished, PR created"

IMPORTANT: Always leave a PR comment if any manual steps are needed:
- Database migrations or schema changes
- Environment variable updates  
- Configuration file changes
- Package installations
- Build or deployment steps
- Any other manual intervention required

You are working in a git worktree isolated for this task. Begin implementation now!
`;
}

async function cleanupWorktree(workingDirectory: string): Promise<void> {
  try {
    console.log(`🧹 Cleaning up worktree: ${workingDirectory}`);
    
    // Remove the entire worktree directory
    await fs.rm(workingDirectory, { recursive: true, force: true });
    
    console.log(`✅ Worktree cleaned up: ${workingDirectory}`);
  } catch (error) {
    console.error(`❌ Failed to cleanup worktree ${workingDirectory}:`, error);
  }
}

async function processTask(taskId: string, webhookPayload: any): Promise<void> {
  try {
    console.log(`🚀 Starting automation for task ${taskId}`);

    // Get full task details from ClickUp API
    let taskData: ClickUpTask;
    try {
      console.log(`📡 Fetching task details from ClickUp API...`);
      taskData = await getClickUpTask(taskId);
      console.log(`✅ Retrieved task: ${taskData.name}`);
    } catch (error: any) {
      console.error("❌ Failed to retrieve task details:", error.message);
      console.log("🔄 Using webhook payload as fallback...");
      taskData = {
        id: taskId,
        name: webhookPayload.payload?.name || taskId,
        description: webhookPayload.payload?.text_content || "",
        custom_fields: webhookPayload.payload?.custom_fields || [],
      };
    }

    console.log(`📋 Task data prepared:`, {
      id: taskData.id,
      name: taskData.name,
      description: taskData.description?.substring(0, 100) + "...",
    });

    // Use SDK-based processing
    console.log(`🔧 Starting SDK-based processing...`);
    await processTaskWithSDK(taskId, taskData);
  } catch (error: any) {
    console.error(`❌ Error processing task ${taskId}:`, error.message);
    console.error(`❌ Stack trace:`, error.stack);
  }
}

console.log("🟢 TypeScript server starting...");
console.log("🔑 API Keys loaded:", {
  clickup: CLICKUP_API_KEY ? "YES" : "NO",
  anthropic: ANTHROPIC_API_KEY ? "YES" : "NO",
});

console.log("🤖 Claude Code SDK Environment:", {
  entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ? "YES" : "NO",
  claudecode: process.env.CLAUDECODE ? "YES" : "NO",
  tty_stdin: process.stdin.isTTY ? "YES" : "NO",
  tty_stdout: process.stdout.isTTY ? "YES" : "NO",
});

// Warn about missing Claude Code SDK environment variables
if (!process.env.CLAUDE_CODE_ENTRYPOINT || !process.env.CLAUDECODE) {
  console.warn("⚠️ WARNING: Missing Claude Code SDK environment variables!");
  console.warn("   This may cause the SDK to hang in containerized environments.");
  console.warn("   Required: CLAUDE_CODE_ENTRYPOINT=cli and CLAUDECODE=1");
}

app.listen(PORT, () => {
  console.log(`🚀 ClickUp automation server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`📁 Repo path: ${REPO_PATH}`);
  console.log("✅ TypeScript server ready for webhooks!");
});

