import { Actor, log } from 'apify';

import { fetchTenders } from './fetchTenders.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 200 } = input;

    let tenders;
    try {
        tenders = await fetchTenders(maxItems);
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
