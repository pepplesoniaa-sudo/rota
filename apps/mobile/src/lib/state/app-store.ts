import { create } from 'zustand';
import { MAX_OFFLINE_CACHE_AGE_MS } from '../query/client';

export interface AppState {
  userId: string | null;
  activeTeamId: string | null;
  activeRole: 'OWNER' | 'MANAGER' | 'STAFF' | null;
  isOnline: boolean;
  lastSyncedAt: Date | null;

  // Actions
  setUserId: (userId: string | null) => void;
  setActiveTeam: (teamId: string, role: 'OWNER' | 'MANAGER' | 'STAFF') => void;
  setOnline: (isOnline: boolean) => void;
  setLastSynced: (date: Date) => void;
  reset: () => void;

  // Computed helper for FR-32 offline banner
  getOfflineBannerText: () => string | null;
}

/**
 * L-4: Mobile app-only state managed exclusively with Zustand.
 */
export const useAppStore = create<AppState>((set, get) => ({
  userId: null,
  activeTeamId: null,
  activeRole: null,
  isOnline: true,
  lastSyncedAt: null,

  setUserId: (userId) => set({ userId }),

  setActiveTeam: (teamId, role) =>
    set({
      activeTeamId: teamId,
      activeRole: role,
    }),

  setOnline: (isOnline) => set({ isOnline }),

  setLastSynced: (lastSyncedAt) => set({ lastSyncedAt }),

  reset: () =>
    set({
      userId: null,
      activeTeamId: null,
      activeRole: null,
      isOnline: true,
      lastSyncedAt: null,
    }),

  getOfflineBannerText: () => {
    const { isOnline, lastSyncedAt } = get();
    if (isOnline) {
      return null;
    }

    if (!lastSyncedAt) {
      return 'No offline schedule. Connect to update.';
    }

    const elapsed = Date.now() - lastSyncedAt.getTime();
    if (elapsed > MAX_OFFLINE_CACHE_AGE_MS) {
      return 'No offline schedule. Connect to update.';
    }

    const formattedTime = lastSyncedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Offline. Last updated ${formattedTime}.`;
  },
}));
