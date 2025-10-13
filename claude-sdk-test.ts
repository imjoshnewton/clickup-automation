#!/usr/bin/env tsx
import { query } from "@anthropic-ai/claude-code";

console.log("🧪 Testing Claude Code SDK initialization...");
console.log("Environment check:");
console.log("- CLAUDECODE:", process.env.CLAUDECODE);
console.log("- CLAUDE_CODE_ENTRYPOINT:", process.env.CLAUDE_CODE_ENTRYPOINT);
console.log("- ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING");
console.log("- Working directory:", process.cwd());

async function testClaudeSDK() {
  try {
    console.log("🔄 Starting Claude Code SDK query...");
    
    const messages: any[] = [];
    let messageCount = 0;
    
    // Simple test query
    for await (const msg of query({
      prompt: "Say 'Hello from Claude Code SDK test' and nothing else.",
      options: {
        allowedTools: [],
      },
    })) {
      messageCount++;
      messages.push(msg);
      console.log(`📨 Message ${messageCount}:`, {
        type: msg.type,
        subtype: msg.subtype || "none"
      });
      
      // Limit to prevent infinite loops
      if (messageCount > 10) {
        console.log("🛑 Stopping after 10 messages to prevent infinite loop");
        break;
      }
    }
    
    console.log("✅ Claude Code SDK test completed successfully!");
    console.log(`Total messages: ${messageCount}`);
    
  } catch (error: any) {
    console.error("❌ Claude Code SDK test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Add timeout
const timeout = setTimeout(() => {
  console.error("⏰ Test timed out after 2 minutes");
  process.exit(1);
}, 2 * 60 * 1000);

testClaudeSDK().then(() => {
  clearTimeout(timeout);
  process.exit(0);
}).catch(error => {
  clearTimeout(timeout);
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});