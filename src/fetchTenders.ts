import { log } from 'apify';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { Dispatcher } from 'undici';
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici';

import { buildPostbackPayload } from './parsers/form.js';
import { getCurrentPage, hasNextBlockLink, hasPageLink } from './parsers/pagination.js';
import { parseGrid } from './parsers/table.js';
import type { TenderRow } from './types.js';

const BASE_URL = 'https://webecommerce.cba.gov.ar/VistaPublica/ConsultaPublicaCotizacion.aspx?TIPO_CONSULTA_PUBLICA=LI';

// The pager only ever renders an 11-slot window (paglb1..paglb11) - real
// data on the audit date ended at page 8 with 3 trailing empty slots, so
// this cap is a safety backstop against a future data-volume regression,
// not the expected steady-state stopping condition (that's "no more page
// link" or "0 rows", both hit naturally before this).
const MAX_PAGES_SAFETY_CAP = 60;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

function extractSessionCookie(response: FetchResponse): string | null {
    const raw = response.headers.get('set-cookie');
    if (!raw) return null;
    const match = /ASP\.NET_SessionId=[^;]+/.exec(raw);
    return match ? match[0] : null;
}

// Uses native fetch(), not Crawlee's got-scraping-based CheerioCrawler -
// same reasoning as diario-oficial-cl-monitor, though here the driver is
// different: this is a genuinely STATEFUL sequential postback chain (each
// page's request body must carry the exact ASP.NET_SessionId + __VIEWSTATE
// the previous response returned), which doesn't fit Crawlee's
// independent-request-queue model naturally.
// Deliberately uses undici's own fetch()/Agent/ProxyAgent as a matched set,
// not Node's global fetch() - mixing a standalone `undici` package version
// with the runtime's built-in fetch (which bundles its own, possibly
// different, undici internals) throws "invalid onRequestStart method" from
// deep inside undici's request validation. Verified live 2026-09-04.
async function requestWithRetry(
    init: RequestInit,
    dispatcher: Dispatcher,
    maxRetries = 4,
    baseDelayMs = 1000,
): Promise<FetchResponse> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await undiciFetch(BASE_URL, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const cause = lastError.cause ? ` | cause: ${String(lastError.cause)}` : '';
            log.warning(`Intento ${attempt + 1}/${maxRetries + 1} fallo: ${lastError.message}${cause}`);
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}

// Verified live 2026-09-04: from Apify's cloud (a non-Argentina datacenter
// IP), every request to webecommerce.cba.gov.ar times out at the TCP
// connect stage (ConnectTimeoutError against both resolved IPs, 10s each) -
// this is a network-level block, not an application error. Same pattern as
// pba-tenders-monitor's PBAC target; the fix is the same: Residential+AR
// Apify Proxy. Local dev machines with a real Argentina/unblocked network
// path won't see this - don't mistake "works locally" for "works in the cloud".
export async function fetchTenders(maxItems: number, proxyUrl?: string): Promise<TenderRow[]> {
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : new Agent();
    const results: TenderRow[] = [];
    // Live government data: new tenders can be inserted (sorted first) while
    // this walks pages 1..N, shifting every row behind them by one slot -
    // verified live 2026-09-04, where a fresh tender appearing mid-crawl
    // pushed 2 rows into duplicate positions across two consecutive page
    // fetches. Tracking seen ids makes a multi-page walk idempotent against
    // that kind of concurrent insert without needing a stable snapshot/cursor
    // the source doesn't offer.
    const seenIds = new Set<string>();

    function pushUnique(rows: TenderRow[]): void {
        for (const row of rows) {
            if (results.length >= maxItems) return;
            if (seenIds.has(row.nroCotizacion)) continue;
            seenIds.add(row.nroCotizacion);
            results.push(row);
        }
    }

    const initialResponse = await requestWithRetry({ redirect: 'follow' }, dispatcher);
    let cookie = extractSessionCookie(initialResponse);
    let html = await initialResponse.text();
    let $: CheerioAPI = cheerio.load(html);

    const firstPageRows = parseGrid($);
    pushUnique(firstPageRows);
    log.info(`Pagina 1: ${firstPageRows.length} licitaciones`);

    let currentPage = getCurrentPage($) ?? 1;

    for (let i = 0; i < MAX_PAGES_SAFETY_CAP && results.length < maxItems; i++) {
        const nextPage = currentPage + 1;
        let eventTarget: string;
        if (hasPageLink($, nextPage)) {
            eventTarget = `paglb${nextPage}`;
        } else if (hasNextBlockLink($)) {
            // past the current 11-slot window's edge - "siguiente bloque"
            // both advances a page and slides the window forward.
            eventTarget = 'paglbS';
        } else {
            log.info(`Sin enlace a la pagina ${nextPage} ni bloque siguiente - fin de resultados.`);
            break;
        }

        const payload = buildPostbackPayload($, eventTarget);
        const body = new URLSearchParams(payload).toString();
        const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (cookie) headers.Cookie = cookie;

        let response: FetchResponse;
        try {
            response = await requestWithRetry({ method: 'POST', headers, body, redirect: 'follow' }, dispatcher);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.warning(`Fallo al pedir la pagina ${nextPage} tras reintentos: ${message}. Devolviendo lo acumulado.`);
            break;
        }

        const newCookie = extractSessionCookie(response);
        if (newCookie) cookie = newCookie;

        html = await response.text();
        $ = cheerio.load(html);

        const rows = parseGrid($);
        if (rows.length === 0) {
            log.info(`Pagina ${nextPage}: 0 filas - fin de resultados.`);
            break;
        }

        pushUnique(rows);
        log.info(`Pagina ${nextPage}: ${rows.length} licitaciones`);

        const newPage = getCurrentPage($);
        if (newPage === null || newPage === currentPage) {
            log.warning(`El paginador no avanzo de la pagina ${currentPage} - fin de resultados.`);
            break;
        }
        currentPage = newPage;
    }

    return results;
}
