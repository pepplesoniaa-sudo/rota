import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '../..');

function getRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      files.push(fullPath);
    }
  }
  return files;
}

describe('CS-12 & A-2: Route exports and runtime compliance', () => {
  it('middleware.ts must never exist in apps/api', () => {
    const middlewarePath = path.join(apiRoot, 'middleware.ts');
    expect(fs.existsSync(middlewarePath)).toBe(false);
  });

  it('all route.ts files must export runtime = nodejs and dynamic = force-dynamic', () => {
    const appDir = path.join(apiRoot, 'app');
    const routeFiles = getRouteFiles(appDir);

    expect(routeFiles.length).toBeGreaterThan(0);

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      expect(content).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
      expect(content).toMatch(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/);

      // Must never export revalidate
      expect(content).not.toMatch(/export\s+const\s+revalidate/);
      // Must never have 'use server'
      expect(content).not.toMatch(/['"]use server['"]/);
    }
  });
});
