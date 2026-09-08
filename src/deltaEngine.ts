import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseFechaInicio } from './dateFilter.js';
import { fingerprintOf } from './fingerprint.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { EventType, TenderRecord, TenderRow } from './types.js';

export interface BuildRecordsOptions {
    state: DeltaState;
    onlyNew: boolean;
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
    scrapedAt: string;
    now: Date;
    sourceUrl: string;
}

export interface BuildRecordsResult {
    records: TenderRecord[];
    observedThisRun: { id: string; entry: SeenEntry }[];
}

function classify(previous: SeenEntry | undefined, row: TenderRow, hash: string): { eventType: EventType; previousEstado: string | null } {
    if (!previous) return { eventType: 'NEW_LISTING', previousEstado: null };
    if (previous.estado !== row.estado) return { eventType: 'STATUS_CHANGE', previousEstado: previous.estado };
    if (previous.hash !== hash) return { eventType: 'UPDATED', previousEstado: null };
    return { eventType: 'UNCHANGED', previousEstado: null };
}

// Cordoba's listing is NOT reliably sorted newest-first end to end - see
// AGENTS.md for the live evidence (a real tender, 2026/000033, sits between
// two tenders published on different, later-and-earlier dates within the
// very first page, in both a 2026-09-04 fixture capture and an unchanged
// fresh live pull on 2026-09-06). Early-stop pagination (like
// uk-hse-enforcement-monitor's fetchListingIds) would risk silently missing
// a genuinely new record buried past wherever "N consecutive pages of no
// new ids" happened to trigger, since that heuristic only holds when the
// underlying sort order is a true, stable "newest first" total order.
//
// So `fetchTenders` itself is untouched - it still walks every page up to
// `maxItems` exactly as it did before this change - and `onlyNew` here is a
// SAFE POST-FILTER applied to that already-complete result set. Correct,
// not a pagination-cost optimization.
export function buildTenderRecords(rows: TenderRow[], options: BuildRecordsOptions): BuildRecordsResult {
    const { state, onlyNew, eventTypes, dateRange, scrapedAt, now, sourceUrl } = options;
    const allowed = eventTypes ? new Set<EventType>(eventTypes) : null;

    const records: TenderRecord[] = [];
    const observedThisRun: { id: string; entry: SeenEntry }[] = [];

    for (const row of rows) {
        const previous = state.entries[row.nroCotizacion];
        const hash = fingerprintOf(row);
        const { eventType, previousEstado } = classify(previous, row, hash);
        const isNew = !previous;
        observedThisRun.push({
            id: row.nroCotizacion,
            entry: { estado: row.estado, hash, tipoContratacion: row.tipoContratacion, jurisdiccion: row.jurisdiccion },
        });

        if (onlyNew && eventType === 'UNCHANGED') continue;
        if (allowed && eventType !== 'UNCHANGED' && !allowed.has(eventType)) continue;

        const fechaInicio = parseFechaInicio(row.fechaInicio);
        if (dateRange && !isWithinDateRange(fechaInicio, dateRange, now)) continue;

        records.push({
            ...row,
            record_id: row.nroCotizacion,
            event_type: eventType,
            previousEstado,
            scraped_at: scrapedAt,
            is_new: isNew,
            source_url: sourceUrl,
            contentHash: hash,
        });
    }

    return { records, observedThisRun };
}

/**
 * A previously-seen nroCotizacion absent from THIS run's fetch has left the active listing.
 * Unlike a paginated source that early-stops, this is only trustworthy when the walk was
 * COMPLETE (fetchTenders was not truncated by maxItems, see src/fetchTenders.ts) - a partial
 * walk proves nothing about ids past where it stopped. Gated by the caller (src/main.ts), not
 * here, so this function stays a pure, directly-testable transformation.
 */
export function findClosed(state: DeltaState, fetchedIds: ReadonlySet<string>, scrapedAt: string, sourceUrl: string): TenderRecord[] {
    const closed: TenderRecord[] = [];
    for (const [recordId, entry] of Object.entries(state.entries)) {
        if (fetchedIds.has(recordId)) continue;
        closed.push({
            nroCotizacion: recordId,
            tipoContratacion: entry.tipoContratacion,
            servicioAdministrativo: '',
            jurisdiccion: entry.jurisdiccion,
            fechaInicio: '',
            fechaFinalizacion: '',
            estado: entry.estado,
            prorroga: false,
            items: [],
            telefonoContacto: null,
            record_id: recordId,
            event_type: 'CLOSED',
            previousEstado: null,
            scraped_at: scrapedAt,
            is_new: false,
            source_url: sourceUrl,
            contentHash: entry.hash,
        });
    }
    return closed;
}
