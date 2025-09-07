module.exports = {
  apps: [
    {
      name: 'clickup-automation-ts',
      script: '/home/joshnewton/.bun/bin/bun',
      args: 'server.ts',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      cwd: '/home/joshnewton/Development/clickup-automation',
      env: {
        NODE_ENV: 'production',
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        CLICKUP_API_KEY: process.env.CLICKUP_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLICKUP_WEBHOOK_SECRET: process.env.CLICKUP_WEBHOOK_SECRET,
        REPO_PATH: process.env.REPO_PATH,
        WORKTREE_BASE_DIR: process.env.WORKTREE_BASE_DIR
      },
      error_file: './logs/pm2-error-ts.log',
      out_file: './logs/pm2-out-ts.log',
      log_file: './logs/pm2-combined-ts.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'clickup-automation-cli',
      script: './server-cli.js',
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error-cli.log',
      out_file: './logs/pm2-out-cli.log',
      log_file: './logs/pm2-combined-cli.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};