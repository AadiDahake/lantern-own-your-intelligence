#!/usr/bin/env node
/**
 * The app serves the widget from its own origin, so the build artefact is copied into the app's
 * public directory rather than published. Run as part of `npm run build` in this package.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageRoot, "dist", "lantern.js");
const destination = join(packageRoot, "..", "..", "apps", "web", "public", "widget.js");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`copied ${source} -> ${destination}`);
