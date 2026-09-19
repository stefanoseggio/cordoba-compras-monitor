import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseFechaInicio } from '../src/dateFilter.js';
import { buildTenderRecords, findClosed, isSuspectedFetchFailure } from '../src/deltaEngine.js';
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

/** Fills in every SeenEntry field with an innocuous default so call sites can override just what
 *  a given test cares about (usually estado/hash). */
function seenEntry(overrides: Partial<SeenEntry> = {}): SeenEntry {
    return {
        estado: 'EN PROCESO',
        hash: 'h',
        tipoContratacion: 't',
        servicioAdministrativo: 'sa',
        jurisdiccion: 'j',
        fechaInicio: '01/01/2026',
        fechaFinalizacion: '02/01/2026',
        prorroga: false,
        items: [],
        telefonoContacto: null,
        ...overrides,
    };
}

/** SeenEntry built from a real fetched row - every carried-forward field matches that row
 *  exactly, the way buildTenderRecords itself constructs observedThisRun entries. */
function seenEntryFromRow(row: (typeof rows)[number]): SeenEntry {
    return {
        estado: row.estado,
        hash: fingerprintOf(row),
        tipoContratacion: row.tipoContratacion,
        servicioAdministrativo: row.servicioAdministrativo,
        jurisdiccion: row.jurisdiccion,
        fechaInicio: row.fechaInicio,
        fechaFinalizacion: row.fechaFinalizacion,
        prorroga: row.prorroga,
        items: row.items,
        telefonoContacto: row.telefonoContacto,
    };
}

/** All 25 real rows marked seen+unchanged (their real fingerprint), so onlyNew correctly
 *  excludes every one of them except whatever the caller overrides afterward. */
function unchangedBaselineState(overrides: Record<string, SeenEntry> = {}): DeltaState {
    const entries: Record<string, SeenEntry> = {};
    for (const row of rows) entries[row.nroCotizacion] = seenEntryFromRow(row);
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
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = seenEntryFromRow(row);
        const { records } = build({ state: stateWith(entries), onlyNew: false });

        expect(records).toHaveLength(rows.length); // nothing filtered out
        expect(records[0].is_new).toBe(true);
        expect(records.slice(1).every((r) => r.is_new === false)).toBe(true);
    });

    it('classifies a known id with a different estado as STATUS_CHANGE, with previousEstado set', () => {
        const target = rows[0];
        const state = unchangedBaselineState({ [target.nroCotizacion]: seenEntry({ estado: 'stale-estado', hash: 'irrelevant' }) });

        const { records } = build({ state, onlyNew: true });

        expect(records).toHaveLength(1);
        expect(records[0].event_type).toBe('STATUS_CHANGE');
        expect(records[0].previousEstado).toBe('stale-estado');
        expect(records[0].is_new).toBe(false);
    });

    it('classifies a known id, same estado, different fingerprint as UPDATED', () => {
        const target = rows[0];
        const state = unchangedBaselineState({ [target.nroCotizacion]: seenEntry({ estado: target.estado, hash: 'a-hash-that-will-never-match' }) });

        const { records } = build({ state, onlyNew: true });

        expect(records).toHaveLength(1);
        expect(records[0].event_type).toBe('UPDATED');
    });

    it('classifies a known id, same estado, same fingerprint as UNCHANGED - delivered only when onlyNew=false', () => {
        const target = rows[0];
        const hash = fingerprintOf(target);
        const state = stateWith({ [target.nroCotizacion]: seenEntry({ estado: target.estado, hash }) });

        const full = buildTenderRecords([target], { state, onlyNew: false, scrapedAt: SCRAPED_AT, now: NOW, sourceUrl: SOURCE_URL });
        expect(full.records).toHaveLength(1);
        expect(full.records[0].event_type).toBe('UNCHANGED');

        const delta = buildTenderRecords([target], { state, onlyNew: true, scrapedAt: SCRAPED_AT, now: NOW, sourceUrl: SOURCE_URL });
        expect(delta.records).toHaveLength(0);
    });

    it('eventTypes restricts delivery to the requested subset', () => {
        const [a, b] = rows; // a: unseen -> NEW_LISTING; b: seen, changed estado -> STATUS_CHANGE
        const state = stateWith({ [b.nroCotizacion]: seenEntry({ estado: 'stale', hash: 'x' }) });

        const { records } = build({ state, eventTypes: ['STATUS_CHANGE'] });

        expect(records).toHaveLength(1);
        expect(records[0].record_id).toBe(b.nroCotizacion);
    });

    it('onlyNew=true with a fully-seen, unchanged state: returns zero records, but still reports every fetched id observed this run', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows) entries[row.nroCotizacion] = seenEntryFromRow(row);
        const { records, observedThisRun } = build({ state: stateWith(entries), onlyNew: true });

        expect(records).toHaveLength(0);
        // fetchTenders itself is untouched by this retrofit (safe post-filter,
        // not early-stop) - it still walks the full page, so every id fetched
        // this run is reported for state-persistence purposes.
        expect(observedThisRun.map((o) => o.id)).toEqual(allIds);
    });

    it('onlyNew=true with exactly one unseen id: returns only that record', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = seenEntryFromRow(row);
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
        for (const row of rows.slice(1)) entries[row.nroCotizacion] = seenEntryFromRow(row);
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
            stillHere: seenEntry({ hash: 'h1', tipoContratacion: 'Licitacion Publica', jurisdiccion: 'j1' }),
            goneNow: seenEntry({ hash: 'h2', tipoContratacion: 'Licitacion Privada', jurisdiccion: 'j2' }),
        });
        const closed = findClosed(state, new Set(['stillHere']), SCRAPED_AT, SOURCE_URL);

        expect(closed).toHaveLength(1);
        expect(closed[0].record_id).toBe('goneNow');
        expect(closed[0].event_type).toBe('CLOSED');
        expect(closed[0].estado).toBe('EN PROCESO');
        expect(closed[0].tipoContratacion).toBe('Licitacion Privada');
    });

    it('reports nothing closed when every previously-seen id is still present', () => {
        const state = stateWith({ a: seenEntry() });
        expect(findClosed(state, new Set(['a']), SCRAPED_AT, SOURCE_URL)).toHaveLength(0);
    });

    // Confirmed bug (live-verified 2026-09-19, real tender 2026/000109: Prorroga="SI"): a CLOSED
    // record used to hardcode servicioAdministrativo/fechaInicio/fechaFinalizacion/telefonoContacto
    // to blanks, items to [], and - most severely - prorroga to a fabricated `false`, even though
    // every one of these was known from the tender's last real observation. prorroga:false on a
    // CLOSED record is an affirmative, potentially actively-wrong claim (a real, live extension
    // reported as "not extended"), not a harmless empty placeholder.
    it('carries every real last-known field forward onto a CLOSED record instead of hardcoded blanks/false', () => {
        const state = stateWith({
            goneNow: {
                estado: 'EN PROCESO',
                hash: 'h',
                tipoContratacion: 'Licitacion Privada',
                servicioAdministrativo: 'Direccion de Vialidad',
                jurisdiccion: 'Ministerio de Obras Publicas',
                fechaInicio: '01/09/2026 10:00',
                fechaFinalizacion: '15/09/2026 12:00',
                prorroga: true, // e.g. real tender 2026/000109, confirmed live Prorroga="SI"
                items: [{ renglon: '1', cantidad: '10', precioReferencia: '100', presupuestoOficial: '1000' }],
                telefonoContacto: '0351-1234567',
            },
        });

        const [closed] = findClosed(state, new Set(), SCRAPED_AT, SOURCE_URL);

        expect(closed.servicioAdministrativo).toBe('Direccion de Vialidad');
        expect(closed.fechaInicio).toBe('01/09/2026 10:00');
        expect(closed.fechaFinalizacion).toBe('15/09/2026 12:00');
        expect(closed.prorroga).toBe(true); // must never be silently flipped/defaulted to false
        expect(closed.items).toEqual([{ renglon: '1', cantidad: '10', precioReferencia: '100', presupuestoOficial: '1000' }]);
        expect(closed.telefonoContacto).toBe('0351-1234567');
    });

    it('treats a pre-upgrade SeenEntry missing the newer fields as "unknown at closure" (null), never a fabricated false', () => {
        const legacyEntry = { estado: 'EN PROCESO', hash: 'h' } as SeenEntry; // shape persisted before this fix
        const state = stateWith({ goneNow: legacyEntry });

        const [closed] = findClosed(state, new Set(), SCRAPED_AT, SOURCE_URL);

        expect(closed.prorroga).toBeNull(); // NOT false
        expect(closed.servicioAdministrativo).toBe('');
        expect(closed.items).toEqual([]);
        expect(closed.telefonoContacto).toBeNull();
    });
});

// Bug: a 0-row fetch (page returns HTTP 200 but the #gv results grid never rendered - a
// bot-check interstitial, a session-expired redirect, or a site-structure change) was
// indistinguishable, from fetchedIds alone, from "every previously-tracked tender genuinely
// closed" - findClosed would report every single tracked id as CLOSED, and src/main.ts would
// then delete every one of them from the persisted delta state, permanently losing them. See
// src/deltaEngine.ts's isSuspectedFetchFailure doc comment and src/fetchTenders.ts's
// gridPresent field.
describe('isSuspectedFetchFailure', () => {
    it('flags a 0-row result with no #gv grid present as a suspected failure, not a real mass closure', () => {
        expect(isSuspectedFetchFailure(0, false)).toBe(true);
    });

    it('does NOT flag a genuine 0-tender day - #gv present, legitimately zero data rows', () => {
        expect(isSuspectedFetchFailure(0, true)).toBe(false);
    });

    it('does NOT flag a normal run that actually fetched rows', () => {
        expect(isSuspectedFetchFailure(25, true)).toBe(false);
    });

    it('THE BUG, reproduced end to end: a large previously-tracked state plus a malformed/empty fetch must NOT be reported as a mass closure', () => {
        // A realistic prior state: many tenders tracked from a healthy previous run.
        const entries: Record<string, SeenEntry> = {};
        for (const id of allIds) entries[id] = seenEntry();
        const state = stateWith(entries);

        // Simulates fetchTenders() coming back from a bot-check/session-expired/structurally
        // changed response: 0 tenders parsed, #gv never present.
        const fetchedIds = new Set<string>();
        const gridPresent = false;

        // Without the guard, findClosed alone has no way to know this wasn't a real mass
        // closure - it would report every single tracked tender as CLOSED:
        expect(findClosed(state, fetchedIds, SCRAPED_AT, SOURCE_URL)).toHaveLength(allIds.length);

        // The guard is what src/main.ts checks BEFORE ever calling findClosed - this must be
        // true so the caller skips findClosed entirely and leaves the state untouched this run.
        expect(isSuspectedFetchFailure(fetchedIds.size, gridPresent)).toBe(true);
    });

    it('a REAL mass closure (grid present, genuinely 0 active tenders left) is still correctly detected - the guard must not suppress legitimate behavior', () => {
        const entries: Record<string, SeenEntry> = {};
        for (const id of allIds) entries[id] = seenEntry();
        const state = stateWith(entries);

        const fetchedIds = new Set<string>(); // genuinely nothing active today
        const gridPresent = true; // but the source's own #gv grid rendered normally, just empty

        expect(isSuspectedFetchFailure(fetchedIds.size, gridPresent)).toBe(false);
        expect(findClosed(state, fetchedIds, SCRAPED_AT, SOURCE_URL)).toHaveLength(allIds.length);
    });
});
