#!/usr/bin/env bun
import { query } from "@anthropic-ai/claude-code";
import dotenv from "dotenv";

dotenv.config();

console.log("🧪 Testing Claude SDK in pure headless mode...");

// Force disable TTY detection
process.stdin.isTTY = false;
process.stdout.isTTY = false;
process.stderr.isTTY = false;

// Set essential Claude Code environment variables
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
process.env.CLAUDECODE = "1";

async function testHeadlessSDK() {
  try {
    console.log("📦 Environment check:");
    console.log("- API Key:", process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING");
    console.log("- Entrypoint:", process.env.CLAUDE_CODE_ENTRYPOINT);
    console.log("- ClaudeCode:", process.env.CLAUDECODE);
    console.log("- TTY stdin:", process.stdin.isTTY);
    console.log("- TTY stdout:", process.stdout.isTTY);
    
    console.log("🚀 Starting headless SDK query...");
    
    let messageCount = 0;
    const timeout = setTimeout(() => {
      console.error("⏰ Test timed out after 15 seconds");
      process.exit(1);
    }, 15000);
    
    for await (const msg of query({
      prompt: "Just say 'Hello from headless Claude!' and nothing else.",
      options: {
        allowedTools: [], // No tools to minimize complexity
      },
    })) {
      messageCount++;
      console.log(`📨 Message ${messageCount}: ${msg.type}/${msg.subtype || 'none'}`);
      
      if (msg.type === "result" || messageCount > 5) {
        clearTimeout(timeout);
        console.log("✅ SDK responded successfully");
        return;
      }
    }
  } catch (error: any) {
    console.error("❌ Headless test failed:", error.message);
    process.exit(1);
  }
}

testHeadlessSDK();