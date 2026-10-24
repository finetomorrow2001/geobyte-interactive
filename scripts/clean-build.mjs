// Only regenerable build output; dependencies, source, docs and backups are preserved.
import { rm } from 'node:fs/promises';
const targets = ['../.svelte-kit', '../.vercel/output'];
for (const relative of targets) {
  const target = new URL(relative, import.meta.url);
  await rm(target, { recursive: true, force: true });
  console.log(`Removed regenerable build output: ${target.pathname}`);
}
