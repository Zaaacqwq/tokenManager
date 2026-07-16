module.exports = {
  apps: [
    {
      name: 'token-manager',
      script: 'server/dist/index.js',
      // OOM fix (see OOM-FIX-NOTES.md on VPS): large JSONL parsing needs headroom
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production',
        PORT: 3456,
      },
      env_file: 'server/.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1800M',
    },
  ],
};
