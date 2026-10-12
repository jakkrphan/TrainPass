// PM2 process file for the hospital server. Run from the repo root:
//   npm ci && npx prisma migrate deploy && npm run build:server
//   pm2 start ecosystem.config.cjs && pm2 save        (first time; `pm2 startup` once to survive reboots)
//   pm2 reload ecosystem.config.cjs                   (after each new build)
// Secrets live in .env next to this file (never committed); both the app and the maintenance jobs read it.
// BASE_PATH and other build-time values need `npm run build:server` again before the reload.

const PORT = 3001; // Maintenance scripts fall back to http://localhost:3100 when APP_BASE_URL is unset.

// One-shot jobs: PM2 starts them on its cron schedule and does not restart them when they exit.
const job = (name, script, cron) => ({
  name,
  script,
  cwd: __dirname,
  cron_restart: cron,
  autorestart: false,
  instances: 1,
  exec_mode: "fork",
  time: true,
  env: { NODE_ENV: "production" },
});

module.exports = {
  apps: [
    {
      name: "trainpass",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      // Loaded before server.js changes into .next/standalone, so the path is relative to the repo root.
      node_args: "--env-file=.env",
      // A single process: after() notification sends and in-memory state stay in one place.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT,
        // Behind the reverse proxy on this machine; use 0.0.0.0 if the proxy runs on another host.
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
    job("trainpass-pending-holds", "scripts/run-pending-holds.mjs", "*/15 * * * *"),
    job("trainpass-notifications", "scripts/run-notifications.mjs", "*/5 * * * *"),
    job("trainpass-retention", "scripts/run-retention.mjs", "30 2 * * *"),
  ],
};
