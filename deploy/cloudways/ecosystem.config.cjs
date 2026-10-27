module.exports = {
  apps: [{
    name: 'push-notifications-api',
    cwd: __dirname,
    script: './app.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    time: true,
    env: { NODE_ENV: 'production' },
  }],
};
