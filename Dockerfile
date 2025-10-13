FROM oven/bun:latest

# Install git and other required tools
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    gh \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create user to match host user (for git permissions)
# Check if group 1000 exists, if so use different GID
RUN getent group 1000 >/dev/null && groupadd -g 1001 joshnewton || groupadd -g 1000 joshnewton && \
    getent passwd 1000 >/dev/null && useradd -u 1001 -g joshnewton -m joshnewton || useradd -u 1000 -g joshnewton -m joshnewton

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Use Docker-specific MCP config
RUN cp .mcp.docker.json .mcp.json

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create necessary directories
RUN mkdir -p logs /tmp/claude-automation

# Set proper ownership
RUN chown -R joshnewton:joshnewton /app /tmp/claude-automation

# Switch to non-root user
USER joshnewton

# Expose port
EXPOSE 3000

# Set environment variables for TTY support and tools
ENV TERM=xterm-256color
ENV FORCE_COLOR=1
ENV NODE_ENV=production
ENV HOME=/home/joshnewton
ENV USER=joshnewton
# Critical Claude Code SDK environment variables
ENV CLAUDE_CODE_ENTRYPOINT=cli
ENV CLAUDECODE=1
# Add Claude binary to PATH
ENV PATH="/home/joshnewton/.local/bin:/home/joshnewton/.claude/local:${PATH}"

# Set entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Run the server with TTY support
CMD ["bun", "server.ts"]