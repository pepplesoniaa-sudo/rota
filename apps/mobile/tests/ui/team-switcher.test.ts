import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../src/lib/state/app-store';

describe('FR-08 UI Team Switcher State Management', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it('initializes with null active team and null active role', () => {
    const state = useAppStore.getState();
    expect(state.activeTeamId).toBeNull();
    expect(state.activeRole).toBeNull();
  });

  it('updates active team and active role when user switches teams (FR-08)', () => {
    const teamA = 'team-001';
    const teamB = 'team-002';

    // Switch to Team A as MANAGER
    useAppStore.getState().setActiveTeam(teamA, 'MANAGER');
    expect(useAppStore.getState().activeTeamId).toBe(teamA);
    expect(useAppStore.getState().activeRole).toBe('MANAGER');

    // Switch to Team B as STAFF
    useAppStore.getState().setActiveTeam(teamB, 'STAFF');
    expect(useAppStore.getState().activeTeamId).toBe(teamB);
    expect(useAppStore.getState().activeRole).toBe('STAFF');

    // Switch to Team C as OWNER
    useAppStore.getState().setActiveTeam('team-003', 'OWNER');
    expect(useAppStore.getState().activeTeamId).toBe('team-003');
    expect(useAppStore.getState().activeRole).toBe('OWNER');
  });

  it('clears active team and active role on logout/reset', () => {
    useAppStore.getState().setActiveTeam('team-001', 'MANAGER');
    useAppStore.getState().reset();

    expect(useAppStore.getState().activeTeamId).toBeNull();
    expect(useAppStore.getState().activeRole).toBeNull();
  });
});
