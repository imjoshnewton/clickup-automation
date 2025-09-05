#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get task ID from automation log directory or environment
function getTaskId() {
  try {
    // Check for running automation by looking for recent log files
    const logsDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir)
        .filter(f => f.startsWith('automation_') && f.endsWith('.log'))
        .map(f => ({ 
          name: f, 
          time: fs.statSync(path.join(logsDir, f)).mtime 
        }))
        .sort((a, b) => b.time - a.time);
      
      if (logFiles.length > 0) {
        const match = logFiles[0].name.match(/automation_([^_]+)_/);
        if (match) return match[1];
      }
    }
  } catch (e) {}
  
  return process.env.CLICKUP_TASK_ID || 'unknown';
}

function logEvent(eventType, data = {}) {
  const timestamp = new Date().toISOString();
  const taskId = getTaskId();
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `claude-hooks-${taskId}-${new Date().toISOString().split('T')[0]}.log`);
  
  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logEntry = {
    timestamp,
    taskId,
    eventType,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '[REDACTED]' : 'not set',
      CLICKUP_API_KEY: process.env.CLICKUP_API_KEY ? '[REDACTED]' : 'not set',
      ...data.env
    },
    ...data
  };
  
  // Read stdin if available for tool data
  if (eventType === 'pre-tool-use' || eventType === 'post-tool-use') {
    let stdinData = '';
    try {
      if (process.stdin.isTTY === false && process.stdin.readable) {
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          stdinData += chunk;
        });
        process.stdin.on('end', () => {
          if (stdinData.trim()) {
            try {
              logEntry.toolData = JSON.parse(stdinData);
            } catch (e) {
              logEntry.rawToolData = stdinData;
            }
          }
          writeLog();
        });
        return;
      }
    } catch (e) {
      logEntry.stdinError = e.message;
    }
  }
  
  writeLog();
  
  function writeLog() {
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      fs.appendFileSync(logFile, logLine, 'utf8');
      
      // Also write to general automation log if it exists
      const automationLogFile = path.join(logDir, `automation_${taskId}_${Date.now()}.log`);
      const latestAutomationLog = fs.readdirSync(logDir)
        .filter(f => f.startsWith(`automation_${taskId}_`))
        .map(f => ({ name: f, time: fs.statSync(path.join(logDir, f)).mtime }))
        .sort((a, b) => b.time - a.time)[0];
      
      if (latestAutomationLog) {
        const hookLogEntry = `[${timestamp}] HOOK: ${eventType.toUpperCase()}: ${JSON.stringify(data)}\n`;
        fs.appendFileSync(path.join(logDir, latestAutomationLog.name), hookLogEntry, 'utf8');
      }
    } catch (e) {
      console.error('Hook logging error:', e);
    }
  }
}

// Handle different hook events
const eventType = process.argv[2];
const additionalData = {};

switch (eventType) {
  case 'session-start':
    additionalData.sessionInfo = 'Claude Code session started';
    additionalData.argv = process.argv;
    break;
    
  case 'session-end':
    additionalData.sessionInfo = 'Claude Code session ended';
    break;
    
  case 'user-prompt-submit':
    additionalData.promptInfo = 'User submitted prompt';
    break;
    
  case 'pre-tool-use':
    additionalData.toolEvent = 'Before tool execution';
    break;
    
  case 'post-tool-use':
    additionalData.toolEvent = 'After tool execution';
    break;
    
  default:
    additionalData.unknownEvent = eventType;
}

logEvent(eventType, additionalData);

// Exit successfully
process.exit(0);