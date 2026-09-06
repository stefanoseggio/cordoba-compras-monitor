import { describe, expect, it } from 'vitest';

import { isWithinDateRange, parseFechaInicio } from '../src/dateFilter.js';

describe('parseFechaInicio', () => {
    it('parses a real DD/MM/YYYY HH:mm:ss value, converting Argentina local time (fixed UTC-3) to a true UTC instant', () => {
        // Real value from test/fixtures/page1.html's top row (2026/000091).
        const date = parseFechaInicio('04/09/2026 09:21:28');
        expect(date?.toISOString()).toBe('2026-09-04T12:21:28.000Z');
    });

    it('returns null for null/undefined/empty/malformed input', () => {
        expect(parseFechaInicio(null)).toBeNull();
        expect(parseFechaInicio(undefined)).toBeNull();
        expect(parseFechaInicio('')).toBeNull();
        expect(parseFechaInicio('2026-09-04')).toBeNull();
        expect(parseFechaInicio('not a date')).toBeNull();
    });
});

describe('isWithinDateRange', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');

    it('always passes when no preset is given', () => {
        expect(isWithinDateRange(null, undefined, now)).toBe(true);
        expect(isWithinDateRange(parseFechaInicio('01/01/2000 00:00:00'), undefined, now)).toBe(true);
    });

    it('rejects a null date when a preset is given', () => {
        expect(isWithinDateRange(null, '24h', now)).toBe(false);
    });

    it('correctly buckets a date at each preset boundary', () => {
        const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        expect(isWithinDateRange(twelveHoursAgo, '24h', now)).toBe(true);
        expect(isWithinDateRange(threeDaysAgo, '24h', now)).toBe(false);

        expect(isWithinDateRange(threeDaysAgo, '7d', now)).toBe(true);
        expect(isWithinDateRange(twentyDaysAgo, '7d', now)).toBe(false);

        expect(isWithinDateRange(twentyDaysAgo, '30d', now)).toBe(true);
        expect(isWithinDateRange(sixtyDaysAgo, '30d', now)).toBe(false);
    });
});
