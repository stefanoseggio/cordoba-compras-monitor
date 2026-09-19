import { log } from 'apify';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import { Impit } from 'impit';

import { buildPostbackPayload } from './parsers/form.js';
import { getCurrentPage, hasNextBlockLink, hasPageLink } from './parsers/pagination.js';
import { hasResultsGrid, parseGrid } from './parsers/table.js';
import type { TenderRow } from './types.js';

// Exported for the delta layer's `source_url` envelope field - this portal
// has no stable per-record deep link (every "Ver Detalles"/"Preguntas"
// control is an ASP.NET postback tied to the current session/ViewState, not
// a real URL - verified against the fixtures, no plain <a href> exists for
// any individual tender), so every record's `source_url` points to this
// same general listing page rather than a record-specific one. Disclosed in
// README/AGENTS.md, not silently papered over.
export const BASE_URL =
    'https://webecommerce.cba.gov.ar/VistaPublica/ConsultaPublicaCotizacion.aspx?TIPO_CONSULTA_PUBLICA=LI';

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

interface SimpleResponse {
    ok: boolean;
    status: number;
    getHeader(name: string): string | null;
    text(): Promise<string>;
}

interface RequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
}

// impit migration (2026-09-19): replaces the classic https.request() +
// https-proxy-agent pairing that itself replaced fetch()/undici earlier -
// see the "Real bug #6" section of AGENTS.md for why *that* switch happened
// (a TLS chain-validation error through the proxy that persisted across
// three different HTTP client stacks, and was ultimately fixed with
// NODE_EXTRA_CA_CERTS, not a client-library change). This migration is to
// impit, not back to undici/fetch - impit ships its own Rust-based TLS
// stack (not Node's OpenSSL bindings), so it was NOT safe to assume
// NODE_EXTRA_CA_CERTS (or the Dockerfile ENV wiring it) carries over.
// Live-verified before trusting this (2026-09-19): a direct impit.fetch()
// against the real, unproxied BASE_URL - from a Windows dev machine, so the
// OS-level chain-completion masking documented in AGENTS.md's Real bug #6
// does NOT apply the same way here as it did for Node's fetch - succeeded
// with a 200 and the full #gv grid, using impit's *default* TLS settings
// (no `ignoreTlsErrors`, no equivalent of NODE_EXTRA_CA_CERTS - impit's
// ImpitOptions has no custom/extra-CA option at all, confirmed against the
// installed package's own index.d.ts; the only TLS knob is the blanket
// `ignoreTlsErrors`, which was NOT needed and is deliberately NOT set
// below). Because a forwarding HTTP CONNECT proxy tunnels raw TLS bytes
// without touching the handshake, this result is expected to hold
// unchanged when routed through the Residential+AR proxy too - but that
// specific combination (impit + Apify Proxy + this target, from the actual
// Linux actor container) could not be independently live-verified in this
// session: this Apify account's "Proxy external access" is not enabled, so
// `Actor.createProxyConfiguration().newUrl()` cannot be resolved from a
// local script outside of an actual platform run, and no local Docker/Linux
// container was available either. Flagged in AGENTS.md as the one residual
// gap - watch the first real scheduled run closely.
async function doRequest(impit: Impit, options: RequestOptions): Promise<SimpleResponse> {
    const response = await impit.fetch(BASE_URL, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
    });
    return {
        ok: response.ok,
        status: response.status,
        getHeader: (name) => {
            // Headers.get() joins repeated headers with ", " per the Fetch spec, which is
            // ambiguous for Set-Cookie (commas appear inside Expires attributes) - use the
            // dedicated getSetCookie() accessor for that one case, same as any other
            // spec-compliant Headers implementation exposes it (verified present on impit's
            // ImpitResponse.headers live, 2026-09-19).
            if (name.toLowerCase() === 'set-cookie') {
                const cookies = response.headers.getSetCookie();
                return cookies.length > 0 ? cookies.join(', ') : null;
            }
            return response.headers.get(name);
        },
        text: async () => response.text(),
    };
}

function extractSessionCookie(response: SimpleResponse): string | null {
    const raw = response.getHeader('set-cookie');
    if (!raw) return null;
    const match = /ASP\.NET_SessionId=[^;]+/.exec(raw);
    return match ? match[0] : null;
}

async function requestWithRetry(
    impit: Impit,
    options: RequestOptions,
    maxRetries = 4,
    baseDelayMs = 1000,
): Promise<SimpleResponse> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await doRequest(impit, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const cause = 'cause' in lastError && lastError.cause ? ` | cause: ${String(lastError.cause)}` : '';
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
export interface FetchTendersResult {
    tenders: TenderRow[];
    /**
     * True when maxItems cut the walk short - the loop stopped because the cap was reached,
     * not because the pager ran out of pages. Computed as `results.length >= maxItems` AFTER
     * the walk, not a mid-loop flag: a page that fills the cap exactly is NOT proof the walk
     * was complete (see salta-compras-monitor's AGENTS.md for the exact boundary bug a
     * mid-loop flag produces - this actor's port to v2 applied that lesson directly rather
     * than repeating the mistake). Used by src/main.ts to decide whether it is safe to infer
     * "no longer active" (CLOSED) for a previously-seen id absent from this walk.
     */
    truncatedByMaxItems: boolean;
    /**
     * False when the initial response never contained the #gv results grid at all - not merely
     * 0 data rows within it (a genuine 0-tender day still renders the grid with its header row,
     * see test/fixtures/page_no_results.html). A bot-check interstitial, a session-expired
     * redirect, or a site-structure change can all return HTTP 200 with no #gv anywhere, which
     * parseGrid() alone reports identically to a real empty result (both are "0 rows"). Used by
     * src/main.ts (via src/deltaEngine.ts's isSuspectedFetchFailure) to refuse to treat a
     * grid-less 0-row result as proof every previously-tracked tender closed - see AGENTS.md.
     */
    gridPresent: boolean;
}

export async function fetchTenders(maxItems: number, proxyUrl?: string): Promise<FetchTendersResult> {
    // Not a module-level singleton (unlike the usual impit pattern) on purpose: `proxyUrl` is a
    // per-run value threaded in from main.ts's `Actor.createProxyConfiguration().newUrl()` call,
    // and impit's proxy is fixed at construction time (ImpitOptions.proxyUrl), not settable
    // per-request - so a real singleton would either bake in one run's proxy URL for the whole
    // module's lifetime or require a second client just for the proxied case. Scoping the
    // instance to this call mirrors exactly how the https-proxy-agent `agent` it replaces was
    // already constructed fresh per call for the same reason.
    //
    // Deliberately no `ignoreTlsErrors` here. impit has no equivalent of Node's
    // NODE_EXTRA_CA_CERTS (checked the installed package's index.d.ts - ImpitOptions exposes
    // only the blanket `ignoreTlsErrors` toggle, no custom/extra-CA option), so it was NOT safe
    // to assume the Dockerfile's NODE_EXTRA_CA_CERTS + certs/cordoba-sectigo-chain.pem workaround
    // (see AGENTS.md "Real bug #6") would do anything for impit's own Rust-based TLS stack.
    // Live-verified instead (2026-09-19, direct request against the real BASE_URL): impit's
    // *default* TLS validation already completes this server's incomplete certificate chain on
    // its own and returns the real #gv grid - no `ignoreTlsErrors` needed. Setting it anyway
    // would trade a specific, chain-verified fix (the intermediate+root in
    // certs/cordoba-sectigo-chain.pem were independently confirmed with `openssl verify` before
    // ever being trusted) for blanket "accept any certificate", which is not an equivalent
    // security posture and is not warranted by what was actually observed.
    const impit = new Impit({ browser: 'chrome', proxyUrl });
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

    const initialResponse = await requestWithRetry(impit, {});
    let cookie = extractSessionCookie(initialResponse);
    let html = await initialResponse.text();
    let $: CheerioAPI = cheerio.load(html);

    const firstPageRows = parseGrid($);
    const gridPresent = hasResultsGrid($);
    if (!gridPresent) {
        // Deliberately NOT thrown from here - fetchTenders stays a pure "walk and report what
        // you saw" function (same contract as truncatedByMaxItems above); it's the caller
        // (src/main.ts, via isSuspectedFetchFailure) that decides this is unsafe to feed into
        // CLOSED detection. See the gridPresent field's own doc comment above.
        log.warning(
            'La grilla de resultados (#gv) no esta presente en la respuesta inicial - posible bot-check, sesion expirada, redireccion o cambio estructural del sitio, no necesariamente 0 licitaciones reales.',
        );
    }
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
        const headers: Record<string, string> = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': String(Buffer.byteLength(body)),
        };
        if (cookie) headers.Cookie = cookie;

        let response: SimpleResponse;
        try {
            response = await requestWithRetry(impit, { method: 'POST', headers, body });
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

    return { tenders: results, truncatedByMaxItems: results.length >= maxItems, gridPresent };
}
