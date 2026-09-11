import { chmod, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const outfile = 'dist/collaby.mjs';

await build({
  entryPoints: ['src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  define: { COLLABY_CLI_VERSION: JSON.stringify(manifest.version) },
});

await chmod(outfile, 0o755);
console.log(`Built ${outfile} (v${manifest.version})`);
