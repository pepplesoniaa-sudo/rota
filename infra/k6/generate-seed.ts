import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function computeShardIndex(teamId: string): number {
  const hash = crypto.createHash('sha256').update(teamId).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 2;
}

export interface SeedUser {
  email: string;
  password: string;
  teamId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  userId: string;
}

export interface GeneratedSeed {
  teams: Array<{ id: string; name: string; shardIndex: number }>;
  users: SeedUser[];
}

/**
 * PRD 11 (lines 1716-1763):
 * Generates 50 teams split across both shards, with 600 users (12 per team).
 * Writes seed-users.json for k6 runner.
 */
export function generateSeedData(): GeneratedSeed {
  const teams: Array<{ id: string; name: string; shardIndex: number }> = [];
  const users: SeedUser[] = [];

  let shard0Count = 0;
  let shard1Count = 0;

  // Generate exactly 25 teams for shard 0 and 25 for shard 1
  while (shard0Count < 25 || shard1Count < 25) {
    const candidateId = crypto.randomUUID();
    const shard = computeShardIndex(candidateId);

    if (shard === 0 && shard0Count < 25) {
      teams.push({
        id: candidateId,
        name: `Clinic Team S0-${String(shard0Count + 1).padStart(2, '0')}`,
        shardIndex: 0,
      });
      shard0Count++;
    } else if (shard === 1 && shard1Count < 25) {
      teams.push({
        id: candidateId,
        name: `Clinic Team S1-${String(shard1Count + 1).padStart(2, '0')}`,
        shardIndex: 1,
      });
      shard1Count++;
    }
  }

  // Generate 12 users per team (1 owner, 2 managers, 9 staff = 600 users)
  let userCount = 1;
  const commonPassword = 'Password123!';

  for (const team of teams) {
    for (let u = 1; u <= 12; u++) {
      const userId = crypto.randomUUID();
      let role: SeedUser['role'] = 'STAFF';
      if (u === 1) role = 'OWNER';
      else if (u <= 3) role = 'MANAGER';

      users.push({
        email: `loaduser_${String(userCount).padStart(4, '0')}@example.com`,
        password: commonPassword,
        teamId: team.id,
        role,
        userId,
      });
      userCount++;
    }
  }

  return { teams, users };
}

// Write seed-users.json in infra/k6/
const seed = generateSeedData();
const outPath = path.resolve(import.meta.dirname, 'seed-users.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    seed.users.map((u) => ({
      email: u.email,
      password: u.password,
      teamId: u.teamId,
    })),
    null,
    2,
  ),
);
