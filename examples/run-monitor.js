// run-monitor.js - Fetch active Cordoba, Argentina public tenders (licitaciones)
// via the "Cordoba Argentina Licitaciones - Tender Delta API" Apify Actor.
const { ApifyClient } = require('apify-client');

async function main() {
    // Reads the token from the environment - never hardcode it.
    const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

    const input = {
        maxItems: 100,
        onlyNew: true,
        eventTypes: ['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED', 'CLOSED'],
        dateRange: '7d',
        proxyConfiguration: {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
            apifyProxyCountry: 'AR',
        },
    };

    // .call() starts the run and blocks until it reaches a terminal state.
    const run = await client.actor('q9jhMgJRSGjyNbXKA').call(input);
    console.log(`Run ${run.id} finished with status: ${run.status}`);

    // Fetch and print every tender record the run pushed to its dataset.
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    for (const item of items) {
        console.log(`${item.nroCotizacion} [${item.event_type}] ${item.servicioAdministrativo} - ${item.estado}`);
    }
}

main().catch((err) => {
    console.error('Run failed:', err);
    process.exitCode = 1;
});
