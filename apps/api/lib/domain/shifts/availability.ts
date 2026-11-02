import { DateTime } from 'luxon';
import { AppError } from '@rota/shared';

export interface ShiftSegment {
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  startMinute: number; // 0 to 1439
  endMinute: number; // 1 to 1440
}

export interface UncoveredInterval {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityBlockLike {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Splits a shift in team-local time into calendar day segments (FR-20).
 * Handles cross-midnight shifts by breaking them at 24:00 (1440).
 */
export function splitShiftIntoSegments(startsLocal: DateTime, endsLocal: DateTime): ShiftSegment[] {
  const segments: ShiftSegment[] = [];
  let current = startsLocal;

  while (current < endsLocal) {
    const nextDayStart = current.plus({ days: 1 }).startOf('day');
    const segmentEnd = endsLocal < nextDayStart ? endsLocal : nextDayStart;

    const dayOfWeek = current.weekday;
    const startMinute = current.hour * 60 + current.minute;
    const endMinute = segmentEnd.hasSame(current, 'day')
      ? segmentEnd.hour * 60 + segmentEnd.minute
      : 1440;

    if (endMinute > startMinute) {
      segments.push({ dayOfWeek, startMinute, endMinute });
    }

    current = nextDayStart;
  }

  return segments;
}

/**
 * Finds uncovered intervals for a shift segment given a member's availability blocks (FR-20).
 */
export function findUncoveredIntervals(
  segment: ShiftSegment,
  blocks: AvailabilityBlockLike[],
): UncoveredInterval[] {
  const dayBlocks = blocks.filter((b) => b.dayOfWeek === segment.dayOfWeek);
  const length = segment.endMinute - segment.startMinute;
  const covered = new Array<boolean>(length).fill(false);

  for (const b of dayBlocks) {
    const from = Math.max(segment.startMinute, b.startMinute);
    const to = Math.min(segment.endMinute, b.endMinute);
    for (let m = from; m < to; m++) {
      covered[m - segment.startMinute] = true;
    }
  }

  const uncovered: UncoveredInterval[] = [];
  let runStart: number | null = null;

  for (let i = 0; i < length; i++) {
    if (!covered[i]) {
      if (runStart === null) {
        runStart = segment.startMinute + i;
      }
    } else {
      if (runStart !== null) {
        uncovered.push({
          dayOfWeek: segment.dayOfWeek,
          startMinute: runStart,
          endMinute: segment.startMinute + i,
        });
        runStart = null;
      }
    }
  }

  if (runStart !== null) {
    uncovered.push({
      dayOfWeek: segment.dayOfWeek,
      startMinute: runStart,
      endMinute: segment.endMinute,
    });
  }

  return uncovered;
}

/**
 * Validates whether an assignee is available for the given shift range (FR-20).
 * If assignee has no blocks, they are treated as available.
 * If any part is uncovered and acknowledgeAvailability is not true, throws 409 AVAILABILITY_WARNING.
 */
export function validateAvailability(params: {
  startsLocal: DateTime;
  endsLocal: DateTime;
  blocks: AvailabilityBlockLike[];
  acknowledgeAvailability?: boolean;
}): { isAvailable: boolean; uncoveredIntervals: UncoveredInterval[] } {
  // Member with no blocks saved is treated as available
  if (params.blocks.length === 0) {
    return { isAvailable: true, uncoveredIntervals: [] };
  }

  const segments = splitShiftIntoSegments(params.startsLocal, params.endsLocal);
  const uncoveredIntervals: UncoveredInterval[] = [];

  for (const segment of segments) {
    const uncovered = findUncoveredIntervals(segment, params.blocks);
    uncoveredIntervals.push(...uncovered);
  }

  if (uncoveredIntervals.length > 0) {
    if (!params.acknowledgeAvailability) {
      throw new AppError(
        'AVAILABILITY_WARNING',
        409,
        'Assignee has availability conflicts during this shift',
        { intervals: uncoveredIntervals },
      );
    }
    return { isAvailable: false, uncoveredIntervals };
  }

  return { isAvailable: true, uncoveredIntervals: [] };
}
