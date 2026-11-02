import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = import.meta.dirname;
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');

if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else if (fs.existsSync(envExamplePath)) {
  process.loadEnvFile(envExamplePath);
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./apps/mobile/tests/setup.ts'],
  },
});
