// Builds the UI as a static bundle in out/ (target: Dynamics 365 HTML web resource).
// Route handlers cannot be statically exported, so app/api is moved aside during the build;
// in that deployment the API (src/server) is hosted separately and NEXT_PUBLIC_API_BASE points to it.
import { renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const api = "app/api";
const parked = ".api-parked";
if (existsSync(parked)) throw new Error(`${parked} exists - restore it to app/api first`);
renameSync(api, parked);
try {
  const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, STATIC_EXPORT: "1" }, shell: process.platform === "win32" });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
} finally {
  renameSync(parked, api);
}
