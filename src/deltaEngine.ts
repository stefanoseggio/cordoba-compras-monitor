import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseFechaInicio } from './dateFilter.js';
import type { TenderRecord, TenderRow } from './types.js';

export interface BuildRecordsOptions {
    seenIds: ReadonlySet<string>;
    onlyNew: boolean;
    dateRange?: DateRangePreset;
    scrapedAt: string;
    now: Date;
    sourceUrl: string;
}

export interface BuildRecordsResult {
    records: TenderRecord[];
    allIdsThisRun: string[];
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
    const allIdsThisRun = rows.map((row) => row.nroCotizacion);
    const records: TenderRecord[] = [];

    for (const row of rows) {
        const isNew = !options.seenIds.has(row.nroCotizacion);
        if (options.onlyNew && !isNew) continue;

        const fechaInicio = parseFechaInicio(row.fechaInicio);
        if (options.dateRange && !isWithinDateRange(fechaInicio, options.dateRange, options.now)) continue;

        records.push({
            ...row,
            record_id: row.nroCotizacion,
            // Every genuinely-new licitacion gets the same default signal -
            // unlike HSE's convictions/notices split, procurement listings
            // don't have a more specific, defensible sub-type to distinguish
            // (a tender isn't itself a "sanction" or similar). See AGENTS.md.
            event_type: 'NEW_LISTING',
            scraped_at: options.scrapedAt,
            is_new: isNew,
            source_url: options.sourceUrl,
        });
    }

    return { records, allIdsThisRun };
}
