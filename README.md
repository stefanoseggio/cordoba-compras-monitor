# Cordoba Government Tenders Monitor - Argentina Public Procurement (Licitaciones)

## Executive Value Proposition

Checking the Province of Cordoba's official procurement portal by hand means clicking through a paginated, stateful ASP.NET grid, re-reading every row to notice what changed, and repeating that on your own schedule. This actor does the same walk programmatically - organism, dates, status, per-item reference budget and contact phone, already in the one listing fetch - and, with delta mode on, tells you specifically which tenders are new, changed status, amended, or closed since your last run, instead of handing you the full list to compare yourself. It scopes to exactly what the source publishes: the active Licitaciones register for the Province of Cordoba, nothing broader.

## Who uses this

- **Contractors and suppliers bidding on Cordoba public works and services.** Pull the active register and use `tipoContratacion` and `servicioAdministrativo` on each returned tender to spot the ones that match what you sell and who's buying. With delta mode on, `STATUS_CHANGE` and the `prorroga` field tell you the moment a tracked tender's deadline is extended or its status moves, without refreshing the portal yourself.
- **Market-entry research for companies evaluating the Cordoba public sector.** Pull a full run (delta mode off) and use `servicioAdministrativo`, `jurisdiccion` and `items[].presupuestoOficial` to see which agencies are actively procuring, at what reference budget, before deciding whether the province is worth pursuing.
- **Procurement consultants and gestores tracking several clients' tenders at once.** Run on a schedule with `onlyNew: true` and get only what changed - `NEW_LISTING`, `STATUS_CHANGE`, `UPDATED` or `CLOSED` - across every tracked `nroCotizacion`, instead of manually re-checking each client's tenders on the portal.

## Input

```json
{
  "maxItems": 200,
  "onlyNew": true,
  "eventTypes": ["NEW_LISTING", "STATUS_CHANGE", "UPDATED", "CLOSED"],
  "dateRange": "7d",
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "AR" }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxItems` | integer | `200` | Hard cap on the number of active tenders returned this run. The source only covers active/open Licitaciones - awarded or historical tenders are out of scope. |
| `proxyConfiguration` | object | Residential + Argentina | Required. The source blocks non-residential-Argentina traffic at the network level (verified live: `ConnectTimeoutError` from Apify's datacenter IPs). Defaults to Residential + AR even if you omit this field. |
| `onlyNew` | boolean | `false` | Delta mode. Persists which tender ids (`nroCotizacion`) this actor has already returned - and their last-known `estado` and content fingerprint - in a named key-value store that survives between scheduled runs, and returns only tenders that are new, changed status, amended, or closed since a prior run. |
| `eventTypes` | array | all four | Which kinds of change to deliver when `onlyNew` is on (ignored - everything delivered - when it is off): `NEW_LISTING`, `STATUS_CHANGE`, `UPDATED`, `CLOSED`. |
| `dateRange` | string | (none) | Optionally restrict results to tenders whose `fechaInicio` (publication date) falls within `"24h"`, `"7d"` or `"30d"`. Independent of `onlyNew`. |

## Output

One dataset record per tender, combining the source's own fields with a standardized integration envelope. Example (real field values, from a tender fetched during development):

```json
{
  "nroCotizacion": "2026/000091",
  "tipoContratacion": "Licitación - Soporte Digital",
  "servicioAdministrativo": "Agencia Córdoba De Inversión Y Financiamiento",
  "jurisdiccion": "Agencia Córdoba De Inversión Y Financiamiento",
  "fechaInicio": "04/09/2026 09:21:28",
  "fechaFinalizacion": "21/09/2026 12:00:00",
  "estado": "EN PROCESO",
  "prorroga": false,
  "items": [
    {
      "renglon": "EJECUCIÓN DUPLICACIÓN Y ROTONDA EN CALLE REFORMA UNIVERSITARIA DE LA CIUDAD DE RÍO CUARTO - DPTO RIO CUARTO",
      "cantidad": "1",
      "precioReferencia": "$ 3.961.365.736,2000",
      "presupuestoOficial": "$ 3.961.365.736,2000"
    }
  ],
  "telefonoContacto": "3517660269",
  "record_id": "2026/000091",
  "event_type": "NEW_LISTING",
  "previousEstado": null,
  "scraped_at": "2026-09-04T20:08:17.311Z",
  "is_new": true,
  "contentHash": "23092e21aec453265045c95e1a122288f48be84c",
  "source_url": "https://webecommerce.cba.gov.ar/VistaPublica/ConsultaPublicaCotizacion.aspx?TIPO_CONSULTA_PUBLICA=LI"
}
```

| Field | Description |
| --- | --- |
| `nroCotizacion` | Tender process number, e.g. `2026/000091` |
| `tipoContratacion` | Contract type, e.g. "Licitación - Soporte Digital" |
| `servicioAdministrativo` | Issuing agency (organism) |
| `jurisdiccion` | Jurisdiction |
| `fechaInicio` | Publication date |
| `fechaFinalizacion` | Closing/opening date and time |
| `estado` | Status, e.g. "EN PROCESO" |
| `prorroga` | Whether the deadline has been extended |
| `items` | Line items: description (`renglon`), quantity, reference price, official budget - extracted inline, no extra request needed |
| `telefonoContacto` | Contact phone, if published |
| `record_id` | Same value as `nroCotizacion` |
| `event_type` | `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `UNCHANGED` / `CLOSED` |
| `previousEstado` | Set only for `STATUS_CHANGE`: the `estado` this record was last seen under |
| `scraped_at` | ISO-8601 timestamp of this run's extraction |
| `is_new` | `true` if this tender's id was not in the persisted seen-set when the run started |
| `contentHash` | sha1 fingerprint of the tender's changeable fields (dates, `prorroga`, items, contact phone), used to detect `UPDATED` between runs |
| `source_url` | The general listing page - this ASP.NET portal has no stable per-tender deep link (every "Ver Detalles" control is a session/ViewState-bound postback, not a plain URL) |

## Reliability

- **Retries with backoff.** Every request (initial GET and each pagination POST) retries up to 4 times with exponential backoff before the run gives up and returns what it has gathered so far.
- **Stateful pagination handled correctly.** The portal is a classic ASP.NET postback/ViewState grid with an 11-slot sliding pager window, not a simple paged URL. The actor tracks the session cookie and replicates the full form state from each response - every input's current value, including the ViewState/EventValidation hidden fields, and only checkboxes actually checked - exactly as a real browser would on postback, including the "siguiente bloque" control that slides the pager window forward past its current 11-slot edge.
- **Deduplicates against live inserts.** Because new tenders can be published while a multi-page walk is in progress (verified live: a freshly-inserted tender shifted later rows into duplicate positions across two consecutive page fetches), every walked row is deduplicated by `nroCotizacion` so a mid-run insert cannot produce duplicate dataset records.
- **TLS chain fixed explicitly.** The source's server sends only its leaf certificate, not the required intermediate, which fails validation in a clean container. The actor supplies the missing intermediate/root via `NODE_EXTRA_CA_CERTS`, additively extending Node's default trust store rather than replacing it.
- **Residential Argentina proxy required and defaulted.** The source blocks non-Argentina datacenter traffic at the network level (verified live: `ConnectTimeoutError` from Apify's own cloud IPs). The actor defaults to Residential + Argentina proxy even if you omit `proxyConfiguration` entirely, so API/CLI callers can't silently fail by leaving it out.
- **Delta state persisted safely.** Delta mode's seen-tender state lives in a named key-value store (survives between scheduled runs, unlike a run's default store) and only marks ids "seen" once they are actually pushed to the dataset this run - a tender held back by `maxItems` or a charge limit stays eligible to be correctly flagged next run rather than silently disappearing from tracking.
- **`CLOSED` is only ever reported against a complete walk.** If `maxItems` cuts a run's page walk short, a previously-tracked tender missing from that partial fetch might simply be past where the walk stopped, not actually gone - so `CLOSED` detection is skipped (and logged) on a truncated run, never guessed.
- **`onlyNew` is a safe post-filter, not early-stop pagination.** Cordoba's listing is not reliably sorted newest-first end to end (a real tender was observed out of publication-date order within the very first page). So delta mode still walks the full listing up to `maxItems` before filtering, rather than risking a missed tender by stopping early.

## Pricing

Pay per event, platform usage included - no separate compute charge:

| Event | Price | When it's charged |
| --- | --- | --- |
| `result` | $0.003 per record | `NEW_LISTING`, `STATUS_CHANGE` or `UPDATED` - full tender content |
| `result-summary` | $0.001 per record | `CLOSED` - a derived absence signal, nothing fresh to fetch |
| Actor start | $0.00005 | Once per run |

The same two rates apply regardless of `onlyNew`: any non-`CLOSED` record (including `UNCHANGED`, delivered only when `onlyNew` is off) bills as a `result`; only `CLOSED` records bill as a `result-summary`. Recurring monitoring with `onlyNew: true` naturally costs less per run because it only delivers what actually changed.

## Support & Enterprise SLA

This is an independently developed and maintained actor, not a managed enterprise product - there is no contractual uptime SLA. Bug reports and feature requests are handled through the actor's issue tracker on the Apify Store; issues are typically triaged within about 48 hours. If the Cordoba portal changes its markup or postback flow, please open an issue with the details you're seeing so the extraction logic can be checked against the live source.
