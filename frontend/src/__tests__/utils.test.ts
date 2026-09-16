/**
 * Utility Function Tests
 *
 * Tests pure utility functions. These have no side effects and
 * require no mocking.
 */

import { describe, it, expect } from 'vitest';
import { formatTime } from '../utils/formatTime';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { generateId } from '../utils/generateId';
import { cn } from '../utils/classNames';

// ── formatTime (takes milliseconds) ───────────────────────────────────────────
describe('formatTime', () => {
  it('formats 0ms as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats 59000ms (59s) as 00:59', () => {
    expect(formatTime(59_000)).toBe('00:59');
  });

  it('formats 60000ms (60s) as 01:00', () => {
    expect(formatTime(60_000)).toBe('01:00');
  });

  it('formats 65000ms (65s) as 01:05', () => {
    expect(formatTime(65_000)).toBe('01:05');
  });

  it('formats 3661000ms as 61:01', () => {
    // Minutes can exceed 59; this is a call timer, not a clock
    expect(formatTime(3_661_000)).toBe('61:01');
  });

  it('returns a MM:SS string for any valid millisecond value', () => {
    const result = formatTime(7_200_000);
    expect(typeof result).toBe('string');
    // Minutes are not capped at 99 — the timer pads seconds only
    expect(result).toMatch(/^\d+:\d{2}$/);
  });
});

// ── formatRelativeTime ─────────────────────────────────────────────────────────
describe('formatRelativeTime', () => {
  it('returns a non-empty string for a recent timestamp', () => {
    const result = formatRelativeTime(Date.now() - 5_000);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a string for a timestamp 10 minutes ago', () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const result = formatRelativeTime(tenMinutesAgo);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── generateId ─────────────────────────────────────────────────────────────────
describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on consecutive calls', () => {
    const ids = Array.from({ length: 10 }, generateId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it('returns a UUID v4 formatted string', () => {
    const id = generateId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

// ── cn (classNames) ────────────────────────────────────────────────────────────
describe('cn', () => {
  it('joins truthy string arguments with spaces', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values (undefined, null, false, 0)', () => {
    expect(cn('a', undefined, 'b', null, false, 'c')).toBe('a b c');
  });

  it('returns empty string when all values are falsy', () => {
    expect(cn(undefined, null, false, 0)).toBe('');
  });

  it('handles a single class name', () => {
    expect(cn('only-class')).toBe('only-class');
  });

  it('handles no arguments', () => {
    expect(cn()).toBe('');
  });
});
