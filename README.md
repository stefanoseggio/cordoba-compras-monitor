# Cordoba Compras Publicas Monitor

Extracts **active public tenders (Licitaciones)** from the Province of
Cordoba, Argentina's official procurement portal, with full detail per
tender - organism, dates, status, per-item reference budget and contact
phone - all from a single request per page, no extra detail lookup needed.

## Delta mode - daily/recurring monitoring, not just a one-off dump

Set `onlyNew: true` and this actor persists which tenders it has already
returned (in its own private key-value store, separate from any single
run's own storage) and, on every subsequent run, returns **only tenders
genuinely new since the last run**.

```json
{ "maxItems": 200, "onlyNew": true }
```

**Implementation note, disclosed plainly:** unlike this fleet's other
delta-enabled monitors, `onlyNew` here does **not** stop pagination early.
Cordoba's listing is not reliably sorted newest-first end to end - a real,
live-verified tender (`2026/000033`) sits between two other tenders
published on different, unrelated dates within the very first page, both in
a captured fixture and in a fresh live pull two days later. Short-circuiting
pagination on that kind of source risks silently missing a genuinely new
tender buried past wherever the "no more new ids" heuristic happened to
trigger. So `onlyNew` fetches up to `maxItems` exactly as a normal run does,
then filters the complete result afterward - correct, just not a
pagination-cost optimization. See `AGENTS.md` for the full live evidence.

Prefer filtering by the source's own date field instead of run-history? Use
`dateRange` (`"24h"`, `"7d"`, or `"30d"`), independent of `onlyNew` - it
filters on `fechaInicio` (Publication Date), the source's own declared
timestamp for the tender.

Run this on an Apify schedule and pipe the output straight into
Slack/Email/Zapier/Make/your own endpoint via [Apify's native dataset
webhooks](https://docs.apify.com/platform/integrations/webhooks) - every
record already carries the standardized integration metadata below, so no
intermediate parser is needed.

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")

# Daily monitoring run - only genuinely new tenders come back
run = client.actor("stefano_seggio/cordoba-compras-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['nroCotizacion']} - {item['servicioAdministrativo']}")
    # -> forward `item` as-is to your webhook/Slack/CRM; the record_id/
    #    event_type/scraped_at/source_url envelope needs no reshaping.
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });

// Daily monitoring run
const run = await client.actor('stefano_seggio/cordoba-compras-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
for (const item of items) {
    // item.record_id / item.event_type / item.scraped_at / item.source_url
    // are already webhook/Zapier/Make-ready - post `item` straight through.
}
```

## What you get

Every record carries this standardized B2B integration envelope:

| Field        | Type    | Description                                                               |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `record_id`  | string  | Same value as `nroCotizacion` - the natural unique id for this tender     |
| `event_type` | string  | Always `NEW_LISTING` (see `AGENTS.md` for why)                            |
| `scraped_at` | string  | ISO-8601 timestamp of this run's extraction                               |
| `is_new`     | boolean | `true` if not seen in a prior run (computed even when `onlyNew` is off)   |
| `source_url` | string  | The general listing page - see Known limitations, no per-tender deep link |

Plus the full domain detail:

| Field                    | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `nroCotizacion`          | Tender process number, e.g. `2026/000091`                           |
| `tipoContratacion`       | Contract type, e.g. "Licitacion - Soporte Digital"                  |
| `servicioAdministrativo` | Issuing agency                                                      |
| `jurisdiccion`           | Jurisdiction                                                        |
| `fechaInicio`            | Publication date                                                    |
| `fechaFinalizacion`      | Closing/opening date and time                                       |
| `estado`                 | Status (e.g. "EN PROCESO")                                          |
| `prorroga`               | Whether the deadline has been extended                              |
| `items`                  | Line items: description, quantity, reference price, official budget |
| `telefonoContacto`       | Contact phone, if published                                         |

## Input

| Field       | Type    | Default | Description                                            |
| ----------- | ------- | ------- | ------------------------------------------------------ |
| `maxItems`  | integer | `200`   | Hard cap on tenders returned this run                  |
| `onlyNew`   | boolean | `false` | Delta mode - see above                                 |
| `dateRange` | string  | (none)  | `"24h"` \| `"7d"` \| `"30d"` - filter by `fechaInicio` |

```json
{ "maxItems": 200 }
```

## Scope

Covers **Licitaciones** (`TIPO_CONSULTA_PUBLICA=LI`) - the only query type
confirmed working on this endpoint. Other contract types (Contratacion
Directa, Concurso de Precios) were checked live and return an error on this
same endpoint; if Cordoba publishes those elsewhere, it's a different page
not covered by this actor yet.

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

**Webhook / Zapier / Make**: configure an [Apify dataset
webhook](https://docs.apify.com/platform/integrations/webhooks) on
`ACTOR.RUN.SUCCEEDED` for this actor and point it at your endpoint - the
standardized `record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`
envelope on every item means no custom parser is needed on the receiving
end.

## Known limitations

- Requires a Residential + Argentina proxy - the source blocks non-Argentina
  datacenter traffic at the network level. This is handled automatically
  (the actor defaults to it even if you don't pass `proxyConfiguration`).
- Only the current, active tender list is available (no historical archive
  browsing was found on this endpoint).
- Live data changes between requests: the actor deduplicates by
  `nroCotizacion` to stay correct even when new tenders are published
  mid-run and shift page contents.
- `source_url` points to the general listing page, not a per-tender deep
  link - this ASP.NET portal has no stable, stateless URL for an individual
  tender (every "Ver Detalles" control is a session/ViewState-bound
  postback, verified against the real markup). To open a specific tender,
  search the listing by its `nroCotizacion`.
- `event_type` is always `NEW_LISTING` - this does not diff individual
  field-level changes to a previously-seen tender (e.g. `estado` or
  `prorroga` changing), which would need full snapshot storage rather than
  id-based delta tracking. Deferred; see `AGENTS.md`.
- `onlyNew` is a safe post-filter, not early-stop pagination - see Delta
  mode above and `AGENTS.md` for the live evidence behind that choice.

Full technical detail, including two real bugs found and fixed while
building this (a viewstate validation failure and a silent
pagination-stall bug), is documented in `AGENTS.md`.
