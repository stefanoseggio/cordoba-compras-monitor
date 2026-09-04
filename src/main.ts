import { existsSync } from 'node:fs';

import { Actor, log } from 'apify';

import { fetchTenders } from './fetchTenders.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    log.info(
        `DIAG: NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS ?? '(unset)'} | exists=${
            process.env.NODE_EXTRA_CA_CERTS ? existsSync(process.env.NODE_EXTRA_CA_CERTS) : 'n/a'
        } | cwd=${process.cwd()}`,
    );

    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 200, proxyConfiguration: proxyConfigurationInput } = input;

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
        await Actor.pushData({ error: message, cause, scrapedAt: new Date().toISOString() });
        return;
    }

    log.info(`Total licitaciones extraidas: ${tenders.length}`);

    let pushed = 0;
    for (const tender of tenders) {
        await Actor.pushData(tender);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            return;
        }
    }

    log.info(`Cargados ${pushed} items al dataset.`);
}
