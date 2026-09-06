import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { buildTenderRecords } from '../src/deltaEngine.js';
import { parseFechaInicio } from '../src/dateFilter.js';
import { parseGrid } from '../src/parsers/table.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

// Real captured page-1 data (25 rows) - same fixture the parser's own tests
// use, not fabricated for this suite.
const PAGE1_HTML = readFileSync(`${fixturesDir}/page1.html`, 'utf-8');
const rows = parseGrid(cheerio.load(PAGE1_HTML));
const allIds = rows.map((r) => r.nroCotizacion);

const SCRAPED_AT = '2026-09-06T12:00:00.000Z';
const NOW = new Date(SCRAPED_AT);
const SOURCE_URL =
    'https://webecommerce.cba.gov.ar/VistaPublica/ConsultaPublicaCotizacion.aspx?TIPO_CONSULTA_PUBLICA=LI';

function build(options: Partial<Parameters<typeof buildTenderRecords>[1]> = {}) {
    return buildTenderRecords(rows, {
        seenIds: new Set<string>(),
        onlyNew: false,
        scrapedAt: SCRAPED_AT,
        now: NOW,
        sourceUrl: SOURCE_URL,
        ...options,
    });
}

describe('buildTenderRecords', () => {
    it('cold run (empty seen-set): every record is marked is_new, envelope fields are correctly stamped', () => {
        const { records, allIdsThisRun } = build();

        expect(records).toHaveLength(rows.length);
        expect(allIdsThisRun).toEqual(allIds);
        for (const [i, record] of records.entries()) {
            expect(record.is_new).toBe(true);
            expect(record.record_id).toBe(rows[i].nroCotizacion);
            expect(record.event_type).toBe('NEW_LISTING');
            expect(record.scraped_at).toBe(SCRAPED_AT);
            expect(record.source_url).toBe(SOURCE_URL);
        }
    });

    it('is_new is computed correctly even when onlyNew=false (a full run still flags which results are new)', () => {
        const seenIds = new Set(allIds.slice(1)); // every id except the newest (index 0) already seen
        const { records } = build({ seenIds, onlyNew: false });

        expect(records).toHaveLength(rows.length); // nothing filtered out
        expect(records[0].is_new).toBe(true);
        expect(records.slice(1).every((r) => r.is_new === false)).toBe(true);
    });

    it('onlyNew=true with a fully-seen state: returns zero records, but still reports every fetched id as seen this run', () => {
        const seenIds = new Set(allIds);
        const { records, allIdsThisRun } = build({ seenIds, onlyNew: true });

        expect(records).toHaveLength(0);
        // fetchTenders itself is untouched by this retrofit (safe post-filter,
        // not early-stop) - it still walks the full page, so every id fetched
        // this run is reported for state-persistence purposes.
        expect(allIdsThisRun).toEqual(allIds);
    });

    it('onlyNew=true with exactly one unseen id: returns only that record', () => {
        const seenIds = new Set(allIds.slice(1)); // everything except the newest
        const { records } = build({ seenIds, onlyNew: true });

        expect(records).toHaveLength(1);
        expect(records[0].record_id).toBe(allIds[0]);
        expect(records[0].is_new).toBe(true);
    });

    it('dateRange filtering excludes out-of-window records, keeping only real records within the window (real Fecha Inicio values)', () => {
        // The top 3 rows of this real fixture are all published within
        // minutes of each other (2026/000091, 000090, 000089, all
        // 04/09/2026); row 4 onward jumps back to 31/08/2026 or earlier -
        // days outside a 24h window anchored 12h after the newest row.
        const newestTimestamp = parseFechaInicio(rows[0].fechaInicio)!;
        const anchoredNow = new Date(newestTimestamp.getTime() + 12 * 60 * 60 * 1000);

        const { records } = build({ dateRange: '24h', now: anchoredNow });

        expect(records.length).toBeGreaterThan(0);
        expect(records.length).toBeLessThan(rows.length); // proves it actually excluded some, not a no-op
        for (const record of records) {
            expect(record.record_id).not.toBe(allIds[3]); // 2026/000081, 31/08 - well outside the window
        }
    });

    it('dateRange filtering excludes everything when "now" is far enough in the future', () => {
        const farFuture = new Date('2099-01-01T00:00:00.000Z');
        const { records } = build({ dateRange: '24h', now: farFuture });
        expect(records).toHaveLength(0);
    });

    it('onlyNew and dateRange combine (both independently applied)', () => {
        const seenIds = new Set(allIds.slice(1)); // everything except the newest is already seen
        const newestTimestamp = parseFechaInicio(rows[0].fechaInicio)!;
        const anchoredNow = new Date(newestTimestamp.getTime() + 1 * 60 * 60 * 1000); // 1h later, still within 24h

        const { records } = build({ seenIds, onlyNew: true, dateRange: '24h', now: anchoredNow });

        expect(records).toHaveLength(1);
        expect(records[0].record_id).toBe(allIds[0]);
    });
});
