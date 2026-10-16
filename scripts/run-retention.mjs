import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for data-retention maintenance");
const base = (process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "") + (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");
const response = await fetch(`${base}/api/jobs/retention`, { headers: { authorization: `Bearer ${secret}` } });
if (!response.ok) throw new Error(`Data-retention maintenance failed: HTTP ${response.status}`);
const result = await response.json();
// Registration data is kept permanently; this job only sweeps orphan files. A failed sweep must show in the cron log.
if (result.orphanFilesDeleted === null) {
  process.stderr.write("Orphan file sweep failed (see the app log); unreferenced uploads stay until a later run succeeds.\n");
  process.exitCode = 1;
} else process.stdout.write(`Deleted ${result.orphanFilesDeleted} orphan files.\n`);
