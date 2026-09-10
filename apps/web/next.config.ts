import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const rootEnvFile = resolve(monorepoRoot, '.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@collaby/shared', '@collaby/editor'],
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

export default config;
