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
*previous* response returned. Crawlee's `CheerioCrawler` models an
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

## Known scope limits (disclosed, not hidden)

- Only `TIPO_CONSULTA_PUBLICA=LI` (Licitaciones) works on this endpoint -
  tried `CD`, `CP`, `SU`, `CO` live, all return HTTP 500. If Cordoba
  publishes Contratacion Directa / Concurso de Precios elsewhere, it's a
  different page/query not yet located - out of scope for v1.
- No proxy needed - verified live, reachable from a plain datacenter IP,
  unlike `pba-tenders-monitor`'s PBAC target.

## Sibling candidates found via parallel live audit (2026-09-04)

A 6-province parallel audit (Santa Fe, Mendoza, Tucuman, Entre Rios, Salta,
Neuquen) found at least 3 strong candidates for the next actors:

- **Santa Fe**: plain PHP, and better than HTML scraping - a documented
  JSON AJAX endpoint (`AppAjax.php?a=consultas.getContrataciones`) returns
  clean structured tender data directly, no HTML parsing needed at all.
- **Tucuman**: plain PHP, GET-querystring pagination (`?pagina_actual=N`),
  no postback/ViewState at all - simplest of the three. Note: backend is
  PHP 4.4.2 (circa 2006) and serves `ISO-8859-1`, not UTF-8 - handle the
  encoding explicitly when building this one.
- **Mendoza**: runs COMPR.AR (same national platform that killed an
  earlier candidate). DevExpress/UpdatePanel/ScriptManager markers ARE
  present, but only in peripheral filter widgets - a plain POST to the
  results-grid button (`ctl00$CPH1$btnListarPliegoAvanzado`) returns a full
  classic `<table>` GridView (not `ASPxGridView`) with real data, no
  callback needed. Real unresolved question before building: the grid's
  own pagination mechanism (likely `__EVENTARGUMENT="Page$N"`) wasn't
  confirmed live - do that before writing schema/code, same discipline as
  always.

Full audit notes (all 6 provinces) are in this session's workflow journal,
not yet copied into a repo - re-run/re-derive before starting the next
actor rather than trusting this summary alone.
