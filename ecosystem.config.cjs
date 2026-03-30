module.exports = {
  apps: [
    {
      name: 'token-manager',
      script: 'server/dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3456,
      },
      env_file: 'server/.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
    },
  ],
};
