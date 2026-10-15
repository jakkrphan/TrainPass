// PM2 process file for the hospital server. Run from the repo root:
//   npm ci && npx prisma migrate deploy && npm run build
//   pm2 start ecosystem.config.cjs && pm2 save        (first time; `pm2 startup` once to survive reboots)
//   pm2 reload ecosystem.config.cjs                   (after each new build)
// Secrets live in .env next to this file (never committed); both the app and the maintenance jobs read it.
// BASE_PATH and other build-time values need `npm run build` again before the reload.

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
      name: "attendpass",
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
        // All interfaces, like `next start`: the front gateway reaches this host by its LAN IP, not loopback.
        // Firewall port 3001 to that gateway so clients cannot bypass it.
        HOSTNAME: "0.0.0.0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
    job("attendpass-pending-holds", "scripts/run-pending-holds.mjs", "*/15 * * * *"),
    job("attendpass-notifications", "scripts/run-notifications.mjs", "*/5 * * * *"),
    job("attendpass-retention", "scripts/run-retention.mjs", "30 2 * * *"),
  ],
};
