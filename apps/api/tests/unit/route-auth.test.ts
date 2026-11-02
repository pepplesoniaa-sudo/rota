import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '../..');

/**
 * SEC-1: Every route declares its auth; public routes are a closed list (B-18, PRD 7.2).
 * Only these are public:
 * - POST /auth/register
 * - POST /auth/login
 * - POST /auth/password-reset/request
 * - POST /auth/password-reset/confirm
 * - GET /invites/:token
 * - GET /healthz
 * - GET /readyz
 */
const ALLOWED_PUBLIC_ROUTES = [
  'app/v1/auth/register/route.ts',
  'app/v1/auth/login/route.ts',
  'app/v1/auth/password-reset/request/route.ts',
  'app/v1/auth/password-reset/confirm/route.ts',
  'app/v1/invites/[token]/route.ts',
  'app/healthz/route.ts',
  'app/readyz/route.ts',
  'app/i/[token]/route.ts',
  'app/r/[token]/route.ts',
];

function getRouteFiles(dir: string, baseDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getRouteFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      files.push(relPath);
    }
  }
  return files;
}

describe('SEC-1: Route Auth Declaration and Closed Public List', () => {
  it('enforces that every route declares auth and public routes are strictly in the allowed set', () => {
    const appDir = path.join(apiRoot, 'app');
    const routeFiles = getRouteFiles(appDir, apiRoot);

    expect(routeFiles.length).toBeGreaterThan(0);

    for (const relPath of routeFiles) {
      const fullPath = path.join(apiRoot, relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Every route must use withApi
      expect(content).toMatch(/withApi\s*\(/);

      // Extract auth property
      const authMatch = content.match(/auth:\s*['"](public|access|refresh|webhook)['"]/);
      expect(authMatch).not.toBeNull();
      if (!authMatch || !authMatch[1]) {
        throw new Error(`Route ${relPath} missing valid auth declaration`);
      }

      const declaredAuth = authMatch[1];

      if (declaredAuth === 'public') {
        const isAllowedPublic = ALLOWED_PUBLIC_ROUTES.some((allowed) => relPath.endsWith(allowed));
        expect(
          isAllowedPublic,
          `Route ${relPath} declared auth: 'public' but is not in the allowed public routes list`,
        ).toBe(true);
      }
    }
  });

  it('verifies POST /v1/auth/register and /login declare auth: public', () => {
    const registerRoutePath = path.join(apiRoot, 'app/v1/auth/register/route.ts');
    expect(fs.readFileSync(registerRoutePath, 'utf-8')).toMatch(/auth:\s*['"]public['"]/);

    const loginRoutePath = path.join(apiRoot, 'app/v1/auth/login/route.ts');
    expect(fs.readFileSync(loginRoutePath, 'utf-8')).toMatch(/auth:\s*['"]public['"]/);
  });

  it('verifies POST /v1/auth/logout and /logout-all declare auth: access', () => {
    const logoutPath = path.join(apiRoot, 'app/v1/auth/logout/route.ts');
    expect(fs.readFileSync(logoutPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const logoutAllPath = path.join(apiRoot, 'app/v1/auth/logout-all/route.ts');
    expect(fs.readFileSync(logoutAllPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);
  });

  it('verifies POST /v1/auth/refresh declares auth: refresh', () => {
    const refreshPath = path.join(apiRoot, 'app/v1/auth/refresh/route.ts');
    expect(fs.readFileSync(refreshPath, 'utf-8')).toMatch(/auth:\s*['"]refresh['"]/);
  });

  it('verifies POST /v1/auth/password-reset/request and /confirm declare auth: public', () => {
    const requestPath = path.join(apiRoot, 'app/v1/auth/password-reset/request/route.ts');
    expect(fs.readFileSync(requestPath, 'utf-8')).toMatch(/auth:\s*['"]public['"]/);

    const confirmPath = path.join(apiRoot, 'app/v1/auth/password-reset/confirm/route.ts');
    expect(fs.readFileSync(confirmPath, 'utf-8')).toMatch(/auth:\s*['"]public['"]/);
  });

  it('verifies POST /v1/teams declares auth: access', () => {
    const teamsPath = path.join(apiRoot, 'app/v1/teams/route.ts');
    expect(fs.readFileSync(teamsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);
  });

  it('verifies team invites and members routes declare correct auth', () => {
    const invitesPath = path.join(apiRoot, 'app/v1/teams/[teamId]/invites/route.ts');
    expect(fs.readFileSync(invitesPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const revokePath = path.join(apiRoot, 'app/v1/teams/[teamId]/invites/[inviteId]/route.ts');
    expect(fs.readFileSync(revokePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const publicInvitePath = path.join(apiRoot, 'app/v1/invites/[token]/route.ts');
    expect(fs.readFileSync(publicInvitePath, 'utf-8')).toMatch(/auth:\s*['"]public['"]/);

    const acceptInvitePath = path.join(apiRoot, 'app/v1/invites/[token]/accept/route.ts');
    expect(fs.readFileSync(acceptInvitePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const membersPath = path.join(apiRoot, 'app/v1/teams/[teamId]/members/route.ts');
    expect(fs.readFileSync(membersPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const memberRolePath = path.join(apiRoot, 'app/v1/teams/[teamId]/members/[userId]/route.ts');
    expect(fs.readFileSync(memberRolePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const leavePath = path.join(apiRoot, 'app/v1/teams/[teamId]/leave/route.ts');
    expect(fs.readFileSync(leavePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const teamDetailsPath = path.join(apiRoot, 'app/v1/teams/[teamId]/route.ts');
    expect(fs.readFileSync(teamDetailsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const ownershipTransferPath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/ownership-transfer/route.ts',
    );
    expect(fs.readFileSync(ownershipTransferPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);
  });
});
