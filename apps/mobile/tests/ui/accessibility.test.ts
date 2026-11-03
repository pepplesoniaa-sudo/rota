import { describe, expect, it, vi } from 'vitest';
import {
  MIN_TOUCH_TARGET,
  formatShiftAccessibilityLabel,
  announceToScreenReader,
} from '../../src/ui/accessibility';
import { AccessibilityInfo } from 'react-native';

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: vi.fn(),
  },
}));

describe('PRD 7.11 Accessibility Rules', () => {
  it('enforces minimum touch targets of at least 44 by 44 points', () => {
    expect(MIN_TOUCH_TARGET.minWidth).toBeGreaterThanOrEqual(44);
    expect(MIN_TOUCH_TARGET.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('formats shift card accessibility labels per PRD 7.11 specification', () => {
    // 2026-11-03 07:00 to 19:30 America/Chicago
    const startsAt = new Date('2026-11-03T13:00:00Z'); // 07:00 CST
    const endsAt = new Date('2026-11-04T01:30:00Z'); // 19:30 CST
    const label = formatShiftAccessibilityLabel({
      position: 'Nurse',
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      teamName: 'Northside Family Clinic',
    });

    expect(label).toContain('Nurse shift');
    expect(label).toContain('Tuesday 3 November');
    expect(label).toContain('7:00 a.m.');
    expect(label).toContain('7:30 p.m.');
    expect(label).toContain('Northside Family Clinic');
    expect(label).toContain('Central');
  });

  it('announces optimistic rollbacks and error messages to screen readers', () => {
    announceToScreenReader('Shift swap request failed. Changes reverted.');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Shift swap request failed. Changes reverted.',
    );
  });
});

