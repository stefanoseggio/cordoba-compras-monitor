import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseFechaInicio } from '../src/dateFilter.js';
import { buildTenderRecords, findClosed } from '../src/deltaEngine.js';
import { fingerprintOf } from '../src/fingerprint.js';
import { parseGrid } from '../src/parsers/table.js';
import type { DeltaState, SeenEntry } from '../src/state.js';

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
const EMPTY_STATE: DeltaState = { entries: {}, lastRunAt: '' };

function build(options: Partial<Parameters<typeof buildTenderRecords>[1]> = {}) {
    return buildTenderRecords(rows, {
        state: EMPTY_STATE,
        onlyNew: false,
        scrapedAt: SCRAPED_AT,
        now: NOW,
        sourceUrl: SOURCE_URL,
        ...options,
    });
}

function stateWith(entries: Record<string, SeenEntry>): DeltaState {
    return { entries, lastRunAt: '' };
}

/** All 25 real rows marked seen+unchanged (their real fingerprint), so onlyNew correctly
 *  excludes every one of them except whatever the caller overrides afterward. */
function unchangedBaselineState(overrides: Record<string, SeenEntry> = {}): DeltaState {
    const entries: Record<string, SeenEntry> = {};
    for (const row of rows) entries[row.nroCotizacion] = { estado: row.estado, hash: fingerprintOf(row), tipoContratacion: 't', jurisdiccion: 'j' };
    return stateWith({ ...entries, ...overrides });
}

describe('buildTenderRecords', () => {
    it('cold run (empty state): every record is NEW_LISTING/is_new, envelope fields are correctly stamped', () => {
        const { records, observedThisRun } = build();

        expect(records).toHaveLength(rows.length);
        expect(observedThisRun.map((o) => o.id)).toEqual(allIds);
        for (const [i, record] of records.entries()) {
            expect(record.is_new).toBe(true);
            expect(record.record_id).toBe(rows[i].nroCotizacion);
            expect(record.event_type).toBe('NEW_LISTING');
            expect(record.scraped_at).toBe(SCRAPED_AT);
            expect(record.source_url).toBe(SOURCE_URL);
        }
    });

    it('is_new is computed correctly even when onlyNew=false (a full run still flags which results are new)', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = { estado: row.estado, hash: fingerprintOf(row), tipoContratacion: 't', jurisdiccion: 'j' };
        const { records } = build({ state: stateWith(entries), onlyNew: false });

        expect(records).toHaveLength(rows.length); // nothing filtered out
        expect(records[0].is_new).toBe(true);
        expect(records.slice(1).every((r) => r.is_new === false)).toBe(true);
    });

    it('classifies a known id with a different estado as STATUS_CHANGE, with previousEstado set', () => {
        const target = rows[0];
        const state = unchangedBaselineState({ [target.nroCotizacion]: { estado: 'stale-estado', hash: 'irrelevant', tipoContratacion: 't', jurisdiccion: 'j' } });

        const { records } = build({ state, onlyNew: true });

        expect(records).toHaveLength(1);
        expect(records[0].event_type).toBe('STATUS_CHANGE');
        expect(records[0].previousEstado).toBe('stale-estado');
        expect(records[0].is_new).toBe(false);
    });

    it('classifies a known id, same estado, different fingerprint as UPDATED', () => {
        const target = rows[0];
        const state = unchangedBaselineState({ [target.nroCotizacion]: { estado: target.estado, hash: 'a-hash-that-will-never-match', tipoContratacion: 't', jurisdiccion: 'j' } });

        const { records } = build({ state, onlyNew: true });

        expect(records).toHaveLength(1);
        expect(records[0].event_type).toBe('UPDATED');
    });

    it('classifies a known id, same estado, same fingerprint as UNCHANGED - delivered only when onlyNew=false', () => {
        const target = rows[0];
        const hash = fingerprintOf(target);
        const state = stateWith({ [target.nroCotizacion]: { estado: target.estado, hash, tipoContratacion: 't', jurisdiccion: 'j' } });

        const full = buildTenderRecords([target], { state, onlyNew: false, scrapedAt: SCRAPED_AT, now: NOW, sourceUrl: SOURCE_URL });
        expect(full.records).toHaveLength(1);
        expect(full.records[0].event_type).toBe('UNCHANGED');

        const delta = buildTenderRecords([target], { state, onlyNew: true, scrapedAt: SCRAPED_AT, now: NOW, sourceUrl: SOURCE_URL });
        expect(delta.records).toHaveLength(0);
    });

    it('eventTypes restricts delivery to the requested subset', () => {
        const [a, b] = rows; // a: unseen -> NEW_LISTING; b: seen, changed estado -> STATUS_CHANGE
        const state = stateWith({ [b.nroCotizacion]: { estado: 'stale', hash: 'x', tipoContratacion: 't', jurisdiccion: 'j' } });

        const { records } = build({ state, eventTypes: ['STATUS_CHANGE'] });

        expect(records).toHaveLength(1);
        expect(records[0].record_id).toBe(b.nroCotizacion);
    });

    it('onlyNew=true with a fully-seen, unchanged state: returns zero records, but still reports every fetched id observed this run', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows) entries[row.nroCotizacion] = { estado: row.estado, hash: fingerprintOf(row), tipoContratacion: 't', jurisdiccion: 'j' };
        const { records, observedThisRun } = build({ state: stateWith(entries), onlyNew: true });

        expect(records).toHaveLength(0);
        // fetchTenders itself is untouched by this retrofit (safe post-filter,
        // not early-stop) - it still walks the full page, so every id fetched
        // this run is reported for state-persistence purposes.
        expect(observedThisRun.map((o) => o.id)).toEqual(allIds);
    });

    it('onlyNew=true with exactly one unseen id: returns only that record', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = { estado: row.estado, hash: fingerprintOf(row), tipoContratacion: 't', jurisdiccion: 'j' };
        const { records } = build({ state: stateWith(entries), onlyNew: true });

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
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = { estado: row.estado, hash: fingerprintOf(row), tipoContratacion: 't', jurisdiccion: 'j' };
        const newestTimestamp = parseFechaInicio(rows[0].fechaInicio)!;
        const anchoredNow = new Date(newestTimestamp.getTime() + 1 * 60 * 60 * 1000); // 1h later, still within 24h

        const { records } = build({ state: stateWith(entries), onlyNew: true, dateRange: '24h', now: anchoredNow });

        expect(records).toHaveLength(1);
        expect(records[0].record_id).toBe(allIds[0]);
    });
});

describe('findClosed', () => {
    it('reports a previously-seen id absent from this run\'s fetch as CLOSED, carrying its last-known estado', () => {
        const state = stateWith({
            stillHere: { estado: 'EN PROCESO', hash: 'h1', tipoContratacion: 'Licitacion Publica', jurisdiccion: 'j1' },
            goneNow: { estado: 'EN PROCESO', hash: 'h2', tipoContratacion: 'Licitacion Privada', jurisdiccion: 'j2' },
        });
        const closed = findClosed(state, new Set(['stillHere']), SCRAPED_AT, SOURCE_URL);

        expect(closed).toHaveLength(1);
        expect(closed[0].record_id).toBe('goneNow');
        expect(closed[0].event_type).toBe('CLOSED');
        expect(closed[0].estado).toBe('EN PROCESO');
        expect(closed[0].tipoContratacion).toBe('Licitacion Privada');
    });

    it('reports nothing closed when every previously-seen id is still present', () => {
        const state = stateWith({ a: { estado: 'EN PROCESO', hash: 'h', tipoContratacion: 't', jurisdiccion: 'j' } });
        expect(findClosed(state, new Set(['a']), SCRAPED_AT, SOURCE_URL)).toHaveLength(0);
    });
});
