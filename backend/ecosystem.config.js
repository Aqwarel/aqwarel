// ============================================================
//  PM2 ecosystem config — lexpert backend
//  Usage:
//    pm2 start ecosystem.config.js --env production
//    pm2 save && pm2 startup    # auto-start on reboot
// ============================================================
module.exports = {
  apps: [
    {
      name: 'lexpert',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file:  './logs/pm2-error.log',
      out_file:    './logs/pm2-out.log',
      merge_logs:  true,
      time:        true,
    },
  ],
};
