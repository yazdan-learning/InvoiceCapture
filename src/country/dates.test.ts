import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, isoToLocalDate, localDateToIso } from './dates';

describe('formatDate', () => {
  it('shows a stored date in the Persian calendar for Iran', () => {
    expect(formatDate('2026-10-18', 'persian', 'en-US')).toBe('7/26/1405 AP');
  });

  it('shows the same date in the Gregorian calendar elsewhere', () => {
    expect(formatDate('2026-10-18', 'gregorian', 'en-US')).toBe('10/18/2026');
  });

  it('never shifts a date-only value to the day before', () => {
    expect(formatDate('2026-01-01', 'gregorian', 'en-US')).toBe('1/1/2026');
  });

  it('shows a dash for a missing or invalid date', () => {
    expect(formatDate(null, 'persian')).toBe('—');
    expect(formatDate('not a date', 'persian')).toBe('—');
  });
});

describe('date picker values', () => {
  it('round-trips a stored date through a local Date', () => {
    expect(localDateToIso(isoToLocalDate('2026-10-18')!)).toBe('2026-10-18');
    expect(isoToLocalDate('')).toBeNull();
  });
});

describe('formatDateTime', () => {
  it('formats a timestamp in either calendar without throwing', () => {
    expect(formatDateTime('2026-10-18T10:00:00Z', 'gregorian', 'en-US')).toMatch(/10\/18\/26/);
    expect(formatDateTime('2026-10-18T10:00:00Z', 'persian', 'en-US')).toMatch(/1405/);
  });
});
