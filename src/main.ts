import { Actor, log } from 'apify';

import { buildTenderRecords, findClosed, isSuspectedFetchFailure } from './deltaEngine.js';
import { BASE_URL, fetchTenders } from './fetchTenders.js';
import { loadState, mergeEntries, saveState } from './state.js';
import type { ActorInput } from './types.js';

const EVENT_DETAIL = 'result';
const EVENT_SUMMARY = 'result-summary';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 200, proxyConfiguration: proxyConfigurationInput, onlyNew = false, eventTypes, dateRange } = input;

    // Verified live 2026-09-04: Apify's cloud IPs get ConnectTimeoutError
    // against this source (TCP-level block), same pattern as
    // pba-tenders-monitor's PBAC target. Hardcoding the fallback here, not
    // just as an input-schema prefill, is deliberate - a prefill only helps
    // Console users; API/CLI callers who omit the field entirely would
    // otherwise get no proxy and silently fail in the cloud.
    const proxyConfiguration = await Actor.createProxyConfiguration(
        proxyConfigurationInput ?? { groups: ['RESIDENTIAL'], countryCode: 'AR' },
    );
    const proxyUrl = await proxyConfiguration?.newUrl();

    let tenders;
    let truncatedByMaxItems;
    let gridPresent;
    try {
        const result = await fetchTenders(maxItems, proxyUrl);
        tenders = result.tenders;
        truncatedByMaxItems = result.truncatedByMaxItems;
        gridPresent = result.gridPresent;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error && error.cause ? String(error.cause) : null;
        log.error(`Fallo la extraccion: ${message}${cause ? ` | cause: ${cause}` : ''}`);
        await Actor.pushData({ error: message, cause, scraped_at: new Date().toISOString() });
        return;
    }

    log.info(`Total licitaciones obtenidas de la fuente: ${tenders.length}${truncatedByMaxItems ? ' (maxItems reached - not a complete census)' : ''}`);

    // Delta layer, applied on top of the existing fetch/pagination flow
    // above - unchanged by this retrofit. onlyNew is a safe post-filter,
    // not early-stop pagination - see AGENTS.md for why.
    const now = new Date();
    const scrapedAt = now.toISOString();
    const state = await loadState();

    const { records, observedThisRun } = buildTenderRecords(tenders, {
        state,
        onlyNew,
        eventTypes,
        dateRange,
        scrapedAt,
        now,
        sourceUrl: BASE_URL,
    });

    // CLOSED is only safe to compute against a COMPLETE, TRUSTWORTHY walk (see AGENTS.md "Delta
    // engine v2", and entrerios-compras-monitor's AGENTS.md for the closely related bug this
    // mirrors on a different axis: there it was an applied filter making the fetch a subset,
    // here it is maxItems truncation - both mean "this fetch did not see everything", which is
    // one precondition CLOSED absolutely needs). isSuspectedFetchFailure guards the OTHER
    // precondition: a 0-row result is only trustworthy when the #gv grid actually rendered -
    // otherwise a bot-check page, a session-expired redirect, or a site-structure change would
    // be indistinguishable from "every tender genuinely closed" and would wipe the entire delta
    // state on a false positive (see src/deltaEngine.ts's isSuspectedFetchFailure doc comment).
    const fetchedIds = new Set(tenders.map((t) => t.nroCotizacion));
    const closedAllowed = !eventTypes || eventTypes.includes('CLOSED');
    const suspectedFetchFailure = isSuspectedFetchFailure(tenders.length, gridPresent);
    const closed =
        truncatedByMaxItems || !closedAllowed || suspectedFetchFailure
            ? []
            : findClosed(state, fetchedIds, scrapedAt, BASE_URL);
    if (truncatedByMaxItems && Object.keys(state.entries).length > 0) {
        log.info('Skipping CLOSED detection this run: the walk was truncated by maxItems, so it is not a complete census.');
    }
    if (suspectedFetchFailure && Object.keys(state.entries).length > 0) {
        log.error(
            `Skipping CLOSED detection this run: obtuvimos 0 licitaciones y la grilla #gv no estaba presente en la respuesta - esto parece un bot-check, una sesion expirada o un cambio estructural del sitio, no un dia real sin licitaciones activas. Se preservan sin cambios las ${Object.keys(state.entries).length} licitaciones ya rastreadas para que una proxima corrida valida pueda detectar un cierre real.`,
        );
    }
    const allRecords = [...records, ...closed];

    log.info(
        `Licitaciones a cargar tras el filtro delta: ${allRecords.length} (onlyNew=${onlyNew}, dateRange=${dateRange ?? 'ninguno'})`,
    );

    let pushed = 0;
    const byEventType: Record<string, number> = {};
    const pushedNonClosed: { id: string; entry: (typeof observedThisRun)[number]['entry'] }[] = [];
    const pushedClosedIds: string[] = [];

    for (const record of allRecords) {
        const eventName = record.event_type === 'CLOSED' ? EVENT_SUMMARY : EVENT_DETAIL;
        // pushData's own eventName argument performs the PPE charge - a separate
        // Actor.charge() call after it would double-charge the customer. Verified against the
        // installed apify SDK's own pushData(item, eventName): Promise<ChargeResult> overload -
        // see salta-compras-monitor's AGENTS.md for the real double-charge bug this avoids.
        const { eventChargeLimitReached } = await Actor.pushData(record, eventName);
        pushed += 1;
        byEventType[record.event_type] = (byEventType[record.event_type] ?? 0) + 1;
        if (record.event_type === 'CLOSED') pushedClosedIds.push(record.record_id);
        else {
            const observed = observedThisRun.find((o) => o.id === record.record_id);
            if (observed) pushedNonClosed.push(observed);
        }

        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            break;
        }
    }

    // Only ids actually pushed this run are marked "seen"/"forgotten" - a record that was
    // fetched (or found closed) but held back by maxItems or the charge limit must stay
    // eligible - correctly flagged next run - rather than silently vanishing from delta mode
    // without ever being delivered.
    const baseEntries = { ...state.entries };
    for (const id of pushedClosedIds) delete baseEntries[id];
    const nextEntries = mergeEntries(baseEntries, pushedNonClosed);
    await saveState(nextEntries, scrapedAt);

    log.info(
        `Cargados ${pushed} items al dataset (${Object.entries(byEventType)
            .map(([type, count]) => `${type}=${count}`)
            .join(', ')}).`,
    );
}
