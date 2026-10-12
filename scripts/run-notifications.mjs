import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for notification delivery");
const base = (process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "") + (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");
const response = await fetch(`${base}/api/jobs/notifications`, { headers: { authorization: `Bearer ${secret}` } });
if (!response.ok) throw new Error(`Notification delivery failed: HTTP ${response.status}`);
const result = await response.json();
process.stdout.write(`Sent ${result.sent}, failed ${result.failed}, retrying ${result.retry}, skipped ${result.skipped}.\n`);
