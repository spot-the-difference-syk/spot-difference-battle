// 운영 Cloudflare Worker에 연결하는 웹 번들을 만든다.
//   web      같은 Worker가 제공하는 운영 웹(서버 주소 = 현재 사이트)
//   ait      앱인토스 번들
//   android  Android 앱 assets로 복사
//   ios      iOS(Capacitor) 앱으로 복사
// 앱·앱인토스는 다른 주소에서 열리므로 서버 주소가 필요하다. 기본값은
// scripts/production.config.json 이고, VITE_SERVER_URL 로 바꿀 수 있다.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const TARGETS = ["web", "ait", "android", "ios"];
const root = resolve(import.meta.dirname, "..");
const target = process.argv[2] ?? "web";
if (!TARGETS.includes(target)) throw new Error(`Use one of: ${TARGETS.join(", ")}`);

function run(command, args, options = {}) {
  const result = spawnSync(process.platform === "win32" ? `${command}.cmd` : command, args, {
    stdio: "inherit", shell: process.platform === "win32", ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export async function gameServerUrl(env = process.env) {
  const configured = env.VITE_SERVER_URL?.trim()
    || JSON.parse(await readFile(resolve(root, "scripts/production.config.json"), "utf8")).gameServerUrl;
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Game server URL must be an https origin: ${configured}`);
  }
  return url.origin;
}

const env = { ...process.env, VITE_GAME_TRANSPORT: "cloudflare" };
env.VITE_SERVER_URL = target === "web" ? "" : await gameServerUrl();
if (target !== "web") console.log(`Game server: ${env.VITE_SERVER_URL}`);

run("pnpm", ["--filter", "@spot-battle/web", target === "ait" ? "build:ait" : "build"], { env });

if (target === "android") {
  const source = resolve(root, "apps/web/dist");
  const assets = resolve(root, "apps/android/app/src/main/assets");
  await rm(assets, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await cp(source, assets, { recursive: true });
  await writeFile(resolve(assets, ".gitkeep"), "");
  console.log(`Copied web bundle to ${assets}`);
}

if (target === "ios") {
  run("pnpm", ["--filter", "@spot-battle/ios", "exec", "cap", "sync", "ios"]);
}
