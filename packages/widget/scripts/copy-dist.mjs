// Publishes the built bundle as the web app's /widget.js so the embed snippet
// can point at the dashboard origin. Skipped when the web app is not present.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The widget itself, and the scanner alone for the explorer.
const bundles = [
  { source: resolve(here, '../dist/lantern.js'), target: resolve(here, '../../../apps/web/public/widget.js') },
  { source: resolve(here, '../dist/scanner.js'), target: resolve(here, '../../../apps/web/public/scanner.js') },
];

try {
  await stat(resolve(here, '../../../apps/web'));
} catch {
  console.log('[widget] apps/web not present, skipping public/widget.js copy');
  process.exit(0);
}

for (const { source, target } of bundles) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`[widget] copied ${source.split('/').slice(-2).join('/')} -> ${target}`);
}
