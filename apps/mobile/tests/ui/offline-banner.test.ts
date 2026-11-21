import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../src/lib/state/app-store';
import { MAX_OFFLINE_CACHE_AGE_MS } from '../../src/lib/query/client';

describe('FR-32 OfflineBanner State & Text Rules', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it('returns null when the device is online (banner is hidden)', () => {
    useAppStore.getState().setOnline(true);
    useAppStore.getState().setLastSynced(new Date());

    const bannerText = useAppStore.getState().getOfflineBannerText();
    expect(bannerText).toBeNull();
  });

  it('returns "No offline schedule. Connect to update." when offline and never synced', () => {
    useAppStore.getState().setOnline(false);

    const bannerText = useAppStore.getState().getOfflineBannerText();
    expect(bannerText).toBe('No offline schedule. Connect to update.');
  });

  it('returns "Offline. Last updated {time}." when offline with recent sync under 14 days (FR-32)', () => {
    useAppStore.getState().setOnline(false);
    // Recent sync 1 hour ago (< 14 days)
    const syncDate = new Date(Date.now() - 60 * 60 * 1000);
    useAppStore.getState().setLastSynced(syncDate);

    const bannerText = useAppStore.getState().getOfflineBannerText();
    expect(bannerText).toContain('Offline. Last updated');
  });

  it('returns "No offline schedule. Connect to update." when offline with sync older than 14 days (FR-32)', () => {
    useAppStore.getState().setOnline(false);
    // 15 days ago (> 14 days)
    const oldSyncDate = new Date(Date.now() - (MAX_OFFLINE_CACHE_AGE_MS + 24 * 60 * 60 * 1000));
    useAppStore.getState().setLastSynced(oldSyncDate);

    const bannerText = useAppStore.getState().getOfflineBannerText();
    expect(bannerText).toBe('No offline schedule. Connect to update.');
  });
});
