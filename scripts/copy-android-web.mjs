import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "apps/web/dist");
const target = resolve(root, "apps/android/app/src/main/assets");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

console.log(`Copied Android web assets: ${source} -> ${target}`);
