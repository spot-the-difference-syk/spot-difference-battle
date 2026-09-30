import { spawnSync } from "node:child_process";

const target = process.argv[2] ?? "web";
if (!["web", "ait"].includes(target)) throw new Error("Use web or ait.");
if (target === "ait" && !process.env.VITE_SERVER_URL?.trim()) {
  throw new Error("Set VITE_SERVER_URL to the deployed Cloudflare game Worker origin before building the AIT bundle.");
}
const env = { ...process.env, VITE_GAME_TRANSPORT: "cloudflare" };
// A hosted web build connects to its own Worker; AIT uses the explicitly configured origin.
if (target === "web") env.VITE_SERVER_URL = "";
const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@spot-battle/web", target === "ait" ? "build:ait" : "build"], { env, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
