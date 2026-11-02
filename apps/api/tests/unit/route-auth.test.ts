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

    const mePath = path.join(apiRoot, 'app/v1/me/route.ts');
    expect(fs.readFileSync(mePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const meSettingsPath = path.join(apiRoot, 'app/v1/me/settings/route.ts');
    expect(fs.readFileSync(meSettingsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const mePushTokensPath = path.join(apiRoot, 'app/v1/me/push-tokens/route.ts');
    expect(fs.readFileSync(mePushTokensPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const mePushTokenDeletePath = path.join(
      apiRoot,
      'app/v1/me/push-tokens/[pushTokenId]/route.ts',
    );
    expect(fs.readFileSync(mePushTokenDeletePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const meTeamsPath = path.join(apiRoot, 'app/v1/me/teams/route.ts');
    expect(fs.readFileSync(meTeamsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const shiftsPath = path.join(apiRoot, 'app/v1/teams/[teamId]/shifts/route.ts');
    expect(fs.readFileSync(shiftsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const shiftDetailPath = path.join(apiRoot, 'app/v1/teams/[teamId]/shifts/[shiftId]/route.ts');
    expect(fs.readFileSync(shiftDetailPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const availabilityPath = path.join(apiRoot, 'app/v1/teams/[teamId]/availability/route.ts');
    expect(fs.readFileSync(availabilityPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const availabilityMePath = path.join(apiRoot, 'app/v1/teams/[teamId]/availability/me/route.ts');
    expect(fs.readFileSync(availabilityMePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const publishShiftsPath = path.join(apiRoot, 'app/v1/teams/[teamId]/shifts/publish/route.ts');
    expect(fs.readFileSync(publishShiftsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const copyWeekPath = path.join(apiRoot, 'app/v1/teams/[teamId]/shifts/copy-week/route.ts');
    expect(fs.readFileSync(copyWeekPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapsPath = path.join(apiRoot, 'app/v1/teams/[teamId]/swaps/route.ts');
    expect(fs.readFileSync(swapsPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapAcceptPath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/swaps/[swapId]/accept/route.ts',
    );
    expect(fs.readFileSync(swapAcceptPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapDeclinePath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/swaps/[swapId]/decline/route.ts',
    );
    expect(fs.readFileSync(swapDeclinePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapApprovePath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/swaps/[swapId]/approve/route.ts',
    );
    expect(fs.readFileSync(swapApprovePath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapRejectPath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/swaps/[swapId]/reject/route.ts',
    );
    expect(fs.readFileSync(swapRejectPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);

    const swapCancelPath = path.join(
      apiRoot,
      'app/v1/teams/[teamId]/swaps/[swapId]/cancel/route.ts',
    );
    expect(fs.readFileSync(swapCancelPath, 'utf-8')).toMatch(/auth:\s*['"]access['"]/);
  });
});
