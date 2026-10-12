// `output: "standalone"` leaves public/ and .next/static out of .next/standalone; copy them in after `next build`
// (npm runs it as `postbuild`) so `node .next/standalone/server.js` (PM2, see ecosystem.config.cjs) serves CSS, JS chunks and images.
import { cpSync, existsSync } from "node:fs";

if (!existsSync(".next/standalone/server.js")) throw new Error("Run `next build` first: .next/standalone/server.js is missing");
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
process.stdout.write("Copied public/ and .next/static into .next/standalone.\n");
