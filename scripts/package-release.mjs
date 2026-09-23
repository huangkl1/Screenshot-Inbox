import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(projectRoot, ".release");
const pluginRoot = path.join(releaseRoot, "screenshot-inbox");
const runtimeFiles = ["main.js", "manifest.json", "styles.css"];

await rm(pluginRoot, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });

for (const file of runtimeFiles) {
  await copyFile(path.join(projectRoot, file), path.join(pluginRoot, file));
}

console.log(`Release package created: ${path.relative(projectRoot, pluginRoot)}`);
