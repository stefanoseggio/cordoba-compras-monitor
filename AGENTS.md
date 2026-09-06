# AGENTS.md - Cordoba Compras Publicas Monitor

Technical notes for whoever (human or AI) touches this actor next. Written
plainly, disclosing real gaps rather than hiding them - see the "What was
actually learned" section at the end.

## What this actor does

Extracts active public tenders (Licitaciones) from the Province of Cordoba,
Argentina's official procurement portal
(`webecommerce.cba.gov.ar/VistaPublica/ConsultaPublicaCotizacion.aspx?TIPO_CONSULTA_PUBLICA=LI`),
with organism, dates, status, per-item reference budget, and contact phone -
all inline in the listing response, no separate detail request needed.

## Architecture

No Crawlee dependency - same reasoning as `diario-oficial-cl-monitor`, but
for a different underlying cause: this is a genuinely **stateful sequential
postback chain**, not a queue of independent requests. Each page's POST body
must carry the exact `ASP.NET_SessionId` cookie and `__VIEWSTATE` the
_previous_ response returned. Crawlee's `CheerioCrawler` models an
independent-request queue (`enqueueLinks`), which doesn't fit this shape
naturally - a plain sequential `for` loop with manual cookie/viewstate
threading (`src/fetchTenders.ts`) does.

- `src/parsers/form.ts` - `extractFormFields($)` replicates exactly what a
  real browser submits on postback: every non-button input's current value,
  every select's selected option, and **only checkboxes/radios that are
  actually `checked`**. `buildPostbackPayload($, eventTarget)` adds
  `__EVENTTARGET`/`__EVENTARGUMENT`.
- `src/parsers/pagination.ts` - `getCurrentPage($)` reads the active pager
  slot (`id="paglbl{N}"` - the id literally shifts with the current page).
  `hasPageLink($, page)` checks for a direct link (`id="paglb{page}"`).
  `hasNextBlockLink($)` checks for the "siguiente bloque" control
  (`id="paglbS"`) needed once past the pager's 11-slot sliding window.
- `src/parsers/table.ts` - `parseGrid($)` extracts rows from `#gv > tbody >
tr` (cheerio, like a real browser, auto-inserts `<tbody>` - a bare
  `.children('tr')` on the table itself silently matches nothing).
- `src/fetchTenders.ts` - drives the whole session: GET page 1, then loop
  POSTing `paglb{N}` (or `paglbS` past the window edge), forwarding cookies,
  parsing with cheerio, deduplicating by `nroCotizacion` (see below), until
  no more page link/block link, 0 rows, `maxItems` reached, or a safety cap.

## Real bugs found and fixed while building this (2026-09-04, live-verified)

1. **"Validation of viewstate MAC failed" (HTTP 500) on the first postback
   attempt.** Root cause: sending only the 5 "canonical" ASP.NET fields
   (`__EVENTTARGET/__VIEWSTATE/__VIEWSTATEGENERATOR/__EVENTVALIDATION`) is
   not enough on this app - it also needs `__VIEWSTATEENCRYPTED` and the
   rest of the form's fields present. This was **not** a web-farm/machineKey
   issue despite the error text explicitly suggesting one - 5 fresh
   sessions failed identically, which a real per-node key mismatch
   wouldn't reliably produce.
2. **Postback returned 200 but never advanced past page 1.** Root cause: a
   naive "grab every `<input>`'s declared `value=`" scrape sends all 49
   filter checkboxes as if checked, corrupting the server-side filter state
   silently (no error, just stale content). Real browsers omit unchecked
   checkboxes entirely - `extractFormFields` now does the same.
3. **Sliding pager window.** The pager only ever shows an 11-slot window of
   page numbers; the immediate next page beyond the window's last slot has
   no direct link and is only reachable via `paglbS`, which both advances
   one page and slides the whole window forward. Missing this would have
   silently capped extraction at whatever the first window's last page
   happened to be, contradicting the actual goal (full depth, not a
   truncated MVP).
4. **Live data drift mid-crawl produced real duplicate rows.** The dataset
   grew from 93 to 125+ active tenders over the course of building this
   actor (confirmed live) - new tenders get inserted first-sorted, shifting
   every row behind them by a slot between two sequential page requests.
   `fetchTenders` now tracks seen `nroCotizacion` values and skips repeats,
   making a multi-page walk idempotent against concurrent inserts without
   needing a stable cursor the source doesn't offer.
5. **False alarm, not a bug:** stored dataset values initially looked
   mojibake'd (`LicitaciÃ³n`) when inspected via `cat file |
python -m json.tool` in this Windows/Git-Bash environment. Verified with
   Node (`fs.readFileSync(..., 'utf-8')`) that the file's actual bytes are
   correct UTF-8 (`Licitación`, `RÍO CUARTO` render perfectly) - the
   mis-rendering was `python -m json.tool`'s own stdin-decoding default on
   this platform, not a defect in the actor's output. Documented so a
   future session doesn't chase a phantom encoding bug.

## Real bug #6: cloud deployment blocked, twice, by two unrelated issues

**First blocker - network-level block, same as PBA.** The first cloud run
after everything worked locally failed with `ConnectTimeoutError` at the
TCP level (10s, both resolved IPs) - `webecommerce.cba.gov.ar` blocks
non-Argentina/non-residential traffic, same as PBAC. Fixed the same way:
hardcoded Residential+AR `Actor.createProxyConfiguration()` fallback in
code (not just an input-schema prefill), same reasoning as
`pba-tenders-monitor`.

**Second blocker - a real server misconfiguration, much harder to
diagnose.** Once routed through the proxy, every request failed with
`unable to verify the first certificate`. This took several wrong turns to
root-cause properly - worth recording so a future session doesn't repeat
them:

1. First guess: dispatcher/fetch-library version mismatch. Real and worth
   fixing (the npm `undici` package installed was 8.10.1 while Node 24
   bundles 7.29.0 internally - passing a `ProxyAgent` from the mismatched
   package to Node's global `fetch()` threw a _different_ error, "invalid
   onRequestStart method") - but fixing it did not fix the TLS error.
2. Second guess: `--use-system-ca` (Node's own suggested flag in the error
   message). Set via Dockerfile `ENV NODE_OPTIONS`. No effect.
3. Third guess: switch HTTP client entirely, from fetch()/undici to
   `https.request()` + `https-proxy-agent` (a more battle-tested pattern
   for HTTPS-through-HTTPS-proxy in Node). Same exact error persisted -
   this was the useful negative result: it proved the problem was never
   about the client library, only about certificates.
4. Fourth guess: supply `tls.rootCertificates` (Node's exported default
   root list) plus a manually-extracted extra root cert via the Agent's
   `ca` option. This _broke local validation that had been working_ -
   `tls.rootCertificates` is not actually equivalent to whatever Node's
   real default trust does when `ca` is omitted entirely. Reverted.
5. **Actual root cause**, found via `openssl s_client -showcerts`: the
   server sends **only its leaf certificate**, not the required
   intermediate ("Sectigo Public Server Authentication CA OV R36"). This
   is a genuine misconfiguration on Cordoba's side, not anything wrong
   locally. A Windows dev machine masks this completely - Windows silently
   completes the chain from its own cached intermediate, so local
   `curl`/`fetch()` calls "just worked" all along, which is exactly why
   this took so long to isolate: the failure only reproduces where there's
   no such OS-level fallback (the Linux actor container - and, once
   discovered, locally too, once an explicit `ca` list without the
   intermediate was forced).
   Fix: extracted the intermediate + its root directly from a live TLS
   session (`tls.connect(...).getPeerCertificate(true)`, walking
   `issuerCertificate`), independently chain-verified with
   `openssl verify -CAfile root.pem -untrusted intermediate.pem leaf.pem`
   (result: `leaf.pem: OK`) before trusting it, saved as
   `certs/cordoba-sectigo-chain.pem`, and loaded via
   `NODE_EXTRA_CA_CERTS` (Node's real additive mechanism - unlike passing
   a custom `ca` option to an `Agent`, which _replaces_ the default store
   rather than extending it, confirmed by step 4 above breaking things).

Confirmed working live end-to-end after this: 25+15 tenders across 2 pages
through the Residential+AR proxy in Apify's cloud.

**Lesson for the next actor:** if a target validates fine locally but
fails with a certificate error in the cloud (or through a proxy), check
`openssl s_client -showcerts <host>:443` for the actual wire chain before
assuming anything about missing roots or client library bugs - a
Windows/macOS dev machine's OS-level cert store can silently paper over a
server sending an incomplete chain in a way Linux containers won't.

## Delta engine (2026-09-06 retrofit)

Added `onlyNew`/`dateRange` input plus the standardized B2B output envelope
(`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`) that this
portfolio's fleet now ships across every actor, matching the contract
shipped and cloud-verified on `uk-hse-enforcement-monitor`. `fetchTenders.ts`
and the parsers above are **untouched** by this retrofit - the delta layer
is a pure post-processing step on top of the existing fetch, not a rewrite
of the pagination logic.

- **The critical decision: safe post-filter, not early-stop pagination.**
  HSE's delta engine stops pagination after 2 consecutive pages of no-new
  ids, because both its registers are genuinely, verifiably sorted
  newest-first. Cordoba's is not - live-verified two ways before writing any
  code:
    1. `test/fixtures/page1.html` (a real, unmodified capture from
       2026-09-04) already shows the anomaly in its own top 25 rows: tender
       `2026/000033` (published 24/08/2026 09:57) sits at position 14,
       sandwiched between `2026/000075` (27/08) and `2026/000074`/`2026/000032`
       (both 24/08) - neither `fechaInicio` order nor `nroCotizacion` order
       explains that position. `2026/000084` (31/08) shows the same pattern,
       appearing after a run of 28/08-dated rows.
    2. Re-fetched the live page directly (`curl`, no proxy needed from this
       dev machine - see Known scope limits) on 2026-09-06, two days later:
       byte-identical row order to the fixture, same anomalies in the same
       positions. Not a one-off glitch; the sort key genuinely isn't a stable
       function of either displayed date field or the tender number.

    The likely explanation (not confirmed, not needed to be for the decision):
    the site probably sorts by an internal last-modified/touched id rather
    than `Fecha Inicio`, and something about tenders `000033`/`000084`
    specifically (an edit? a `prorroga`?) touched them more recently than
    their nominal publish date suggests. Whatever the cause, "N consecutive
    pages with no new ids" is not a safe stopping signal here - a genuinely
    new tender could in principle land past that cutoff. So `onlyNew` fetches
    everything up to `maxItems` exactly as a normal run does (unchanged
    `fetchTenders` call), then `src/deltaEngine.ts` filters the complete
    result set afterward. Correct, not a pagination-cost optimization -
    disclosed as such in the input schema and README, not silently shipped as
    if it were the fast path.

- `record_id` = `nroCotizacion` verbatim (already the natural unique id,
  e.g. `2026/000091`) - no hashing, matching the spec.
- `event_type` is always `NEW_LISTING`. Unlike HSE's convictions/notices
  split (`SANCTION` vs `NEW_LISTING`, a real domain distinction - a
  conviction inherently **is** an imposed sanction), a procurement tender
  has no comparably specific, defensible sub-type: every genuinely-new row
  is just a new listing appearing in the active-tenders grid. Inventing a
  finer-grained enum here would be arbitrary, not domain-driven.
- `source_url` is the same `BASE_URL` constant for every record, not a
  per-tender deep link. Checked the real markup for one before deciding
  this: every "Ver Detalles"/"Preguntas" control in the Acciones cell is
  `javascript:WebForm_DoPostBackWithOptions(...)` - an ASP.NET postback tied
  to the current session/ViewState, not a plain `<a href>`. This portal
  simply has no stateless, shareable URL for an individual tender (same
  postback-chain nature documented in Architecture above). Disclosed in
  README's Known limitations rather than fabricating a URL shape that
  wouldn't actually resolve to anything for a fresh visitor.
- `src/state.ts` opens a **named** key-value store
  (`cordoba-compras-monitor-delta-state`), not the run's default one, so
  state survives between scheduled runs - default KV stores are isolated
  per run and would defeat the entire point. Only one sub-dataset here
  (licitaciones), so state is a flat `{ seenIds: string[], lastRunAt:
string }` rather than HSE's per-dataset `Record`. Capped at 5000 ids,
  newest-first (this run's ids are prepended ahead of whatever survives from
  the previous state) - comfortably above this source's whole active-tender
  count (~90-125 observed live) many times over.
- `is_new` is computed from the seen-set regardless of `onlyNew`, so a full
  non-delta run still tells the consumer which of its results are new -
  verified by a dedicated test (`test/deltaEngine.test.ts`) rather than
  just asserted.
- `dateRange` filters on `fechaInicio` via `src/dateFilter.ts`'s
  `parseFechaInicio` (`DD/MM/YYYY HH:mm:ss`, Argentina local time). Argentina
  Time has been a fixed UTC-3 with no daylight saving since 2009, so unlike
  HSE's UK-date approximation (which treats GMT/BST both as UTC and
  discloses the imprecision), converting ART to a true UTC instant here is
  an exact fixed offset - no reason not to do it correctly. This field
  itself looks trustworthy as a per-record timestamp (nothing here suggests
  it lags real publication the way HSE's Offence Date does) - it's the
  listing's own **sort order** that's unreliable, a distinct and narrower
  claim than "the date field is wrong", and worth not conflating with it in
  the docs.
- Tests (`test/dateFilter.test.ts`, `test/deltaEngine.test.ts`,
  `test/state.test.ts`) are all pure unit tests against real fixture data
  (`test/fixtures/page1.html`, parsed with the existing `parseGrid`) or
  synthetic id lists for `mergeSeenIds` - no network mocking needed, since
  (unlike HSE's separate listing/detail fetch split) Cordoba's delta layer
  never touches the network itself; it only post-processes whatever
  `fetchTenders` already returned. This is also why there's no
  `fetchListingIds`-style early-stop test here: there is no early-stop to
  verify, by design (see above).
- **Formatting gotcha found while wiring this up**: `npm run format`
  (`prettier --write .`) errored on `test/fixtures/page1.html`,
  `page2.html`, `page8_last.html`, and `page9_empty.html` - real captured
  HTML with genuinely malformed markup (an unclosed `<b>`/`<b/>` pair in the
  page chrome), which Prettier's HTML parser can't tolerate. This predates
  the delta retrofit entirely (those fixtures were committed in the
  original `feat:` commit) and would have failed identically before this
  change. Fixed by adding `test/fixtures` to `.prettierignore` (matching
  `uk-hse-enforcement-monitor`'s own `.prettierignore`, which already
  excludes it) rather than touching the fixture content - these are real
  captures deliberately kept byte-for-byte as scraped, not files meant to be
  reformatted.

## Known scope limits (disclosed, not hidden)

- Only `TIPO_CONSULTA_PUBLICA=LI` (Licitaciones) works on this endpoint -
  tried `CD`, `CP`, `SU`, `CO` live, all return HTTP 500. If Cordoba
  publishes Contratacion Directa / Concurso de Precios elsewhere, it's a
  different page/query not yet located - out of scope for v1.
- No proxy needed - verified live, reachable from a plain datacenter IP,
  unlike `pba-tenders-monitor`'s PBAC target.

## Sibling candidates found via parallel live audit (2026-09-04)

A 6-province parallel audit (Santa Fe, Mendoza, Tucuman, Entre Rios, Salta,
Neuquen) found 5 viable candidates and 1 clean reject:

- **Santa Fe** (build first, lowest friction): plain PHP, and better than
  HTML scraping - a documented JSON AJAX endpoint
  (`AppAjax.php?a=consultas.getContrataciones`) returns clean structured
  tender data directly, no HTML parsing needed at all.
- **Tucuman**: plain PHP, GET-querystring pagination (`?pagina_actual=N`),
  no postback/ViewState at all. Note: backend is PHP 4.4.2 (circa 2006)
  and serves `ISO-8859-1`, not UTF-8 - handle the encoding explicitly.
- **Entre Rios**: plain PHP, zero DevExpress/AJAX markers, largest
  confirmed dataset of the batch (2042+ rows).
- **Salta**: Apache/HTML server-rendered, real data in the initial page
  load, zero DevExpress/SPA markers.
- **Mendoza** (viable but the most fragile of the five, build last):
  runs COMPR.AR (same national platform that killed an earlier
  candidate). DevExpress/UpdatePanel/ScriptManager markers ARE present,
  but only in peripheral filter widgets - a plain POST to the
  results-grid button (`ctl00$CPH1$btnListarPliegoAvanzado`) returns a
  full classic `<table>` GridView (not `ASPxGridView`) with real data, no
  callback needed. The grid's own pagination mechanism (likely
  `__EVENTARGUMENT="Page$N"`) was NOT confirmed live - do that before
  writing schema/code.
- **Neuquen - REJECTED**: the obvious URL resets the TLS connection
  outright; the real portal (CO.DI.NEU) returns 200 but the actual data
  grid depends on a GeneXus AJAX+WebSocket protocol tied to session state,
  not reproducible with plain fetch/cheerio without full reverse
  engineering - outside the low-risk standard this portfolio targets.

Full audit notes (all 6 provinces, full technical detail per candidate)
are in this session's workflow journal, not yet copied into a repo -
re-run/re-derive (or re-audit fresh, since these are time-sensitive live
findings) before starting the next actor rather than trusting this
summary alone.
