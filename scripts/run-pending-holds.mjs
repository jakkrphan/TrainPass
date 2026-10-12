import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for pending-seat maintenance");
const base = (process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "") + (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");
const response = await fetch(`${base}/api/jobs/pending-holds`, { headers: { authorization: `Bearer ${secret}` } });
if (!response.ok) throw new Error(`Pending-seat maintenance failed: HTTP ${response.status}`);
const result = await response.json();
process.stdout.write(`Checked ${result.checkedEvents} events; expired ${result.expiredRows} pending seats.\n`);
