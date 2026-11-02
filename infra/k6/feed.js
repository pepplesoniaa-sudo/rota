import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:8080/v1';
const users = new SharedArray('users', () => JSON.parse(open('./seed-users.json')));
const duplicates = new Counter('feed_duplicates');
const replicaReads = new Counter('feed_replica_reads');

export const options = {
  setupTimeout: '180s',
  scenarios: {
    feed: {
      executor: 'ramping-vus',
      exec: 'feedChain',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    feed_rate: {
      executor: 'constant-arrival-rate',
      exec: 'feedPage',
      rate: 300,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 300,
      maxVUs: 600,
      startTime: '7m',
    },
  },
  thresholds: {
    'http_req_duration{name:feed}': ['p(95)<300'],
    'http_req_failed{name:feed}': ['rate<0.01'],
    'http_req_duration{name:feed_rate}': ['p(95)<300'],
    'http_req_failed{name:feed_rate}': ['rate<0.01'],
    feed_duplicates: ['count==0'],
  },
};

export function setup() {
  // 600 seeded users, 12 per team, across 50 teams on both shards.
  // Tokens last 15 min. Setup takes about 1 min and the run about 12.5 min.
  return users.slice(0, 600).map((u) => {
    const res = http.post(
      `${BASE}/auth/login`,
      JSON.stringify({ email: u.email, password: u.password }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
    return { token: res.json('accessToken'), teamId: u.teamId };
  });
}

// Headline scenario: 200 virtual users, each paging through the feed like a person.
export function feedChain(sessions) {
  const s = sessions[(__VU - 1) % 200];
  const params = { headers: { Authorization: `Bearer ${s.token}` }, tags: { name: 'feed' } };
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 5; page++) {
    const url = `${BASE}/teams/${s.teamId}/feed?limit=20${cursor ? `&cursor=${cursor}` : ''}`;
    const res = http.get(url, params);
    const ok = check(res, { 'status 200': (r) => r.status === 200 });
    if (!ok) break;
    if (res.headers['X-Read-Source'] === 'replica') replicaReads.add(1);
    const body = res.json();
    for (const item of body.items) {
      if (seen.has(item.id)) duplicates.add(1);
      seen.add(item.id);
    }
    cursor = body.nextCursor;
    if (!cursor) break;
    sleep(1 + Math.random() * 2);
  }
  sleep(5 + Math.random() * 5);
}

// Throughput scenario: 300 first-page requests a second spread over 600 users,
// about 30 requests a minute per user, under the 120 per minute rate limit.
export function feedPage(sessions) {
  const s = sessions[Math.floor(Math.random() * sessions.length)];
  const params = { headers: { Authorization: `Bearer ${s.token}` }, tags: { name: 'feed_rate' } };
  const res = http.get(`${BASE}/teams/${s.teamId}/feed?limit=20`, params);
  check(res, { 'status 200': (r) => r.status === 200 });
  if (res.headers['X-Read-Source'] === 'replica') replicaReads.add(1);
}
