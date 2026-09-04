# Cordoba Compras Publicas Monitor

Extracts **active public tenders (Licitaciones)** from the Province of
Cordoba, Argentina's official procurement portal, with full detail per
tender - organism, dates, status, per-item reference budget and contact
phone - all from a single request per page, no extra detail lookup needed.

## What you get

| Field | Description |
|---|---|
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
| `scrapedAt` | ISO timestamp of extraction |

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `maxItems` | integer | `200` | Hard cap on tenders returned this run |

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

## Known limitations

- Requires a Residential + Argentina proxy - the source blocks non-Argentina
  datacenter traffic at the network level. This is handled automatically
  (the actor defaults to it even if you don't pass `proxyConfiguration`).
- Only the current, active tender list is available (no historical archive
  browsing was found on this endpoint).
- Live data changes between requests: the actor deduplicates by
  `nroCotizacion` to stay correct even when new tenders are published
  mid-run and shift page contents.

Full technical detail, including two real bugs found and fixed while
building this (a viewstate validation failure and a silent
pagination-stall bug), is documented in `AGENTS.md`.
