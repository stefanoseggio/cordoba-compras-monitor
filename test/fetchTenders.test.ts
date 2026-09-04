import { describe, expect, it } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';

// Live check against the real site - skipped in CI (same lesson as
// pba-tenders-monitor and diario-oficial-cl-monitor: don't make CI depend
// on an external host with no uptime guarantee). Run locally with
// `npm test` to actually exercise the full stateful postback chain against
// the live source.
describe.skipIf(process.env.CI)('live fetchTenders against the real Cordoba portal', () => {
    it('walks multiple real pages and returns well-formed tenders', async () => {
        const tenders = await fetchTenders(60);

        expect(tenders.length).toBeGreaterThan(25); // proves pagination actually advanced past page 1
        for (const t of tenders) {
            expect(t.nroCotizacion).toMatch(/^\d{4}\/\d+$/);
            expect(t.scrapedAt).toBeTruthy();
        }

        const ids = tenders.map((t) => t.nroCotizacion);
        expect(new Set(ids).size).toBe(ids.length); // no duplicate rows across pages
    }, 60_000);

    it('respects maxItems as a hard cap even when more real data exists', async () => {
        const tenders = await fetchTenders(5);
        expect(tenders.length).toBeLessThanOrEqual(5);
    }, 30_000);
});
