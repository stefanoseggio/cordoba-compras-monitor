import { Actor, log } from 'apify';

import { buildTenderRecords } from './deltaEngine.js';
import { BASE_URL, fetchTenders } from './fetchTenders.js';
import { loadState, saveState } from './state.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 200, proxyConfiguration: proxyConfigurationInput, onlyNew = false, dateRange } = input;

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
    try {
        tenders = await fetchTenders(maxItems, proxyUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error && error.cause ? String(error.cause) : null;
        log.error(`Fallo la extraccion: ${message}${cause ? ` | cause: ${cause}` : ''}`);
        await Actor.pushData({ error: message, cause, scraped_at: new Date().toISOString() });
        return;
    }

    log.info(`Total licitaciones obtenidas de la fuente: ${tenders.length}`);

    // Delta layer, applied on top of the existing fetch/pagination flow
    // above - unchanged by this retrofit. onlyNew is a safe post-filter,
    // not early-stop pagination - see AGENTS.md for why.
    const now = new Date();
    const scrapedAt = now.toISOString();
    const state = await loadState();
    const seenIds = new Set(state.seenIds);

    const { records, allIdsThisRun } = buildTenderRecords(tenders, {
        seenIds,
        onlyNew,
        dateRange,
        scrapedAt,
        now,
        sourceUrl: BASE_URL,
    });

    // Persisted regardless of onlyNew/dateRange output filtering, and before
    // the push loop below, so state isn't lost if a charge limit interrupts
    // it partway through - every id actually fetched this run counts as
    // "seen" for the next run, whether or not it was returned this time.
    await saveState(state, allIdsThisRun, scrapedAt);

    log.info(
        `Licitaciones a cargar tras el filtro delta: ${records.length} (onlyNew=${onlyNew}, dateRange=${dateRange ?? 'ninguno'})`,
    );

    let pushed = 0;
    for (const record of records) {
        await Actor.pushData(record);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            return;
        }
    }

    log.info(`Cargados ${pushed} items al dataset.`);
}
