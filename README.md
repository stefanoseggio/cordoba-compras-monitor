# Cordoba Tenders Scraper & Monitor

**The tender-alert feed the Province of Cordoba never shipped.** Extracts every active public tender (Licitaciones) from the Province of Cordoba, Argentina's official procurement portal, with full detail per tender - organism, dates, status, per-item reference budget and contact phone - all from a single request per page, no extra detail lookup needed - and keeps it fresh with a delta mode that reports what is genuinely **new, changed status, amended, or closed**.

[![Cordoba Tenders Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/cordoba-compras-monitor)](https://apify.com/stefano_seggio/cordoba-compras-monitor)

- **Status changes and amendments, free.** `estado` and every mutable field (dates, prorroga, line items, contact) are already in every fetched row - status transitions and amendments (e.g. a deadline extension) are detected at zero extra cost.
- **Knows when a tender leaves the active list.** A previously-tracked tender absent from a complete walk is reported `CLOSED` - awarded, closed or withdrawn. Only trusted against a complete (non-truncated) walk, never guessed.
- **Handles a genuinely hard portal correctly.** A stateful ASP.NET postback/ViewState session, a sliding 11-slot pager window, a server that only sends its leaf TLS certificate (fixed via an explicitly chain-verified `NODE_EXTRA_CA_CERTS`), and a network-level block on non-Argentina traffic (fixed via Residential+AR proxy) - all handled so you don't have to.

## Who uses Cordoba procurement data

| Team | Question they ask | Fields that answer it | Decision |
| --- | --- | --- | --- |
| Suppliers to provincial organisms | Did a tracked tender get awarded/closed, or its deadline extended? | `estado`, `event_type=STATUS_CHANGE`/`UPDATED`/`CLOSED`, `prorroga` | Stop chasing a closed tender, or re-check one that changed |
| Bid consultants and gestores managing several clients | What changed across my clients' tracked tenders since yesterday? | `event_type`, `previousEstado`, `items` | Notify the client with the specific change |
| Regional tender-data resellers / LATAM procurement platforms | A structured, change-aware Cordoba feed instead of a screen scrape that also has to solve the TLS/proxy problems | The whole envelope (`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`, `contentHash`) | Buy vs. build a scraper for a genuinely hard portal |
| Journalists, researchers, transparency groups | Which organisms run the most tenders, at what reference budget? | `servicioAdministrativo`, `items[].presupuestoOficial`, `tipoContratacion` | Spending-pattern analysis |

## Delta mode

Set `onlyNew: true` for recurring/scheduled monitoring and each run returns only tenders that are `NEW_LISTING`, `STATUS_CHANGE` (estado changed), `UPDATED` (a fingerprinted amendment) or `CLOSED` (no longer active). `eventTypes` narrows which you want. Every record also always carries `is_new` (computed even on a plain non-delta run).

**Implementation note, disclosed plainly:** unlike this fleet's other delta-enabled monitors, `onlyNew` here does **not** stop pagination early. Cordoba's listing is not reliably sorted newest-first end to end - a real, live-verified tender (`2026/000033`) sits between two other tenders published on different, unrelated dates within the very first page, both in a captured fixture and in a fresh live pull two days later. Short-circuiting pagination on that kind of source risks silently missing a genuinely new tender buried past wherever the "no more new ids" heuristic happened to trigger. So `onlyNew` fetches up to `maxItems` exactly as a normal run does, then filters the complete result afterward - correct, just not a pagination-cost optimization. See `AGENTS.md` for the full live evidence.

**`CLOSED` only fires when the walk is complete.** If `maxItems` cuts the walk short, a previously-tracked tender absent from that partial fetch might just be past where the walk stopped, not actually gone - so CLOSED is skipped (and logged) on a truncated run. Raise `maxItems` above the real active-tender count to enable it reliably on a recurring monitor.

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/cordoba-compras-monitor").call(run_input={"onlyNew": True, "maxItems": 300})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['nroCotizacion']} - {item['servicioAdministrativo']}")
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/cordoba-compras-monitor').call({ onlyNew: true, maxItems: 300 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

Run this on an Apify schedule and pipe the output straight into Slack/Email/Zapier/Make/your own endpoint via [Apify's native dataset webhooks](https://docs.apify.com/platform/integrations/webhooks) - every record already carries the standardized integration metadata above, so no intermediate parser is needed.

## What you get

| Field | Description |
| --- | --- |
| `record_id` | Same value as `nroCotizacion` - the natural unique id for this tender |
| `event_type` | `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `UNCHANGED` / `CLOSED` |
| `previousEstado` | Set only for `STATUS_CHANGE`: the estado this record_id was last seen under |
| `contentHash` | sha1 fingerprint used to detect `UPDATED` |
| `scraped_at` | ISO-8601 timestamp of this run's extraction |
| `is_new` | `true` if not seen in a prior run (computed even when `onlyNew` is off) |
| `source_url` | The general listing page - see Known limitations, no per-tender deep link |

Plus the full domain detail:

| Field | Description |
| --- | --- |
| `nroCotizacion` | Tender process number, e.g. `2026/000091` |
| `tipoContratacion` | Contract type, e.g. "Licitacion - Soporte Digital" |
| `servicioAdministrativo` | Issuing agency |
| `jurisdiccion` | Jurisdiction |
| `fechaInicio` | Publication date |
| `fechaFinalizacion` | Closing/opening date and time |
| `estado` | Status (e.g. "EN PROCESO") |
| `prorroga` | Whether the deadline has been extended |
| `items` | Line items: description, quantity, reference price, official budget |
| `telefonoContacto` | Contact phone, if published |

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxItems` | integer | `200` | Hard cap on tenders returned this run |
| `onlyNew` | boolean | `false` | Delta mode - see above |
| `eventTypes` | array | all four | Which of `NEW_LISTING`/`STATUS_CHANGE`/`UPDATED`/`CLOSED` to deliver when `onlyNew` is on |
| `dateRange` | string | (none) | `"24h"` \| `"7d"` \| `"30d"` - filter by `fechaInicio` |
| `proxyConfiguration` | object | Residential+AR | Required - the source blocks non-Argentina datacenter traffic at the network level |

```json
{ "maxItems": 200 }
```

## Scope

Covers **Licitaciones** (`TIPO_CONSULTA_PUBLICA=LI`) - the only query type confirmed working on this endpoint. Other contract types (Contratacion Directa, Concurso de Precios) were checked live and return an error on this same endpoint; if Cordoba publishes those elsewhere, it's a different page not covered by this actor yet.

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~cordoba-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxItems": 200}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/cordoba-compras-monitor").call(run_input={"maxItems": 200})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["nroCotizacion"], item["tipoContratacion"], item["estado"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/cordoba-compras-monitor').call({ maxItems: 200 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## How much does it cost to monitor Cordoba tenders?

Pay per event, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | **$0.003** per record | `NEW_LISTING`, `STATUS_CHANGE` or `UPDATED` - full content, already inline in every listing row |
| `result-summary` | **$0.001** per record | `CLOSED` - a derived absence signal, nothing fresh to fetch |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 5 changes across the active register costs about $0.02/day (~$0.45/month).

## Known limitations

- Requires a Residential + Argentina proxy - the source blocks non-Argentina datacenter traffic at the network level. This is handled automatically (the actor defaults to it even if you don't pass `proxyConfiguration`).
- Only the current, active tender list is available (no historical archive browsing was found on this endpoint).
- Live data changes between requests: the actor deduplicates by `nroCotizacion` to stay correct even when new tenders are published mid-run and shift page contents.
- `source_url` points to the general listing page, not a per-tender deep link - this ASP.NET portal has no stable, stateless URL for an individual tender (every "Ver Detalles" control is a session/ViewState-bound postback, verified against the real markup). To open a specific tender, search the listing by its `nroCotizacion`.
- `onlyNew` is a safe post-filter, not early-stop pagination - see Delta mode above and `AGENTS.md` for the live evidence behind that choice.
- `CLOSED` is only ever reported when this run's walk was complete (not truncated by `maxItems`) - see Delta mode above.
- The real-world `estado` value observed on every fetched tender so far is "EN PROCESO" - `STATUS_CHANGE` is tracked and reported correctly if the source ever shows a different value, but has not been observed firing in practice.

Full technical detail, including real bugs found and fixed while building this (a viewstate validation failure, a silent pagination-stall bug, and a genuine server-side TLS misconfiguration), is documented in `AGENTS.md`.
