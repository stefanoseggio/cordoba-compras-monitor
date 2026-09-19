# Changelog

## [3.0.0](https://github.com/stefanoseggio/cordoba-compras-monitor/compare/cordoba-compras-monitor-v2.0.0...cordoba-compras-monitor-v3.0.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* v2.0 delta engine - STATUS_CHANGE/UPDATED/CLOSED, applying prior fleet lessons

### Features

* Cordoba Compras Publicas Monitor - full-depth pagination, fetch/cheerio only ([5130481](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/51304817942f715ed1dd3829353082ece18ab5c4))
* retrofit Delta Engine (onlyNew/dateRange delta monitoring) ([661ce71](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/661ce7176684668178191b1c07e68f9692b0ac15))
* v2.0 delta engine - STATUS_CHANGE/UPDATED/CLOSED, applying prior fleet lessons ([2ec2e77](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/2ec2e778c4195725f97235fa9b43baf0c7b90759))


### Bug Fixes

* bump transitive adm-zip to 0.6.1, resolving a HIGH-severity CVE ([#10](https://github.com/stefanoseggio/cordoba-compras-monitor/issues/10)) ([585448c](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/585448c0df9c9d15efbc94fb09a7b75a9fb814d5))
* carry real last-known fields onto CLOSED records instead of blanks/false ([#9](https://github.com/stefanoseggio/cordoba-compras-monitor/issues/9)) ([a1519e6](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/a1519e6a349b1dd9e7c714fd29ebf4fdd61d4f68))
* **ci:** pass RELEASE_PLEASE_TOKEN so release PRs skip the bot-approval gate ([7b55a0d](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/7b55a0d31c7e9208b3ee47aa6d53bf2b400610e2))
* guard CLOSED detection against a grid-less 0-row fetch ([#8](https://github.com/stefanoseggio/cordoba-compras-monitor/issues/8)) ([13c778e](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/13c778ebeaba9e3177f736c407a821aae30dd174))
* include ES2022 lib for Error.cause, add richer retry/error diagnostics ([65d05cc](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/65d05cc2a6e8fd005dffd08dec386c71ecddfb62))
* pin undici to Node 24's exact internal version, use global fetch ([85bbc14](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/85bbc14fa40399cdf466246188cdb59c5b608ec1))
* route through Residential+AR Apify Proxy - source blocks cloud IPs at TCP level ([b1ba33a](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/b1ba33a6f77c2d5f812a0b996dbc38b6c263263a))
* supply the missing intermediate cert, not the root - root cause found ([4ad6a6b](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/4ad6a6b17627e36e4b61e2630f0635e0447bba4c))
* switch HTTP layer to https.request + https-proxy-agent ([22220d5](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/22220d5efe61c1d456c8a8963a31ef8d0cb250bc))
* trust the source's newer root CA via NODE_EXTRA_CA_CERTS, not a custom Agent ca option ([1f6a33c](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/1f6a33c4cb628ff98b34d14f99e1949f6b23bbf3))
* use Node's --use-system-ca to trust the source's newer root CA ([60a9307](https://github.com/stefanoseggio/cordoba-compras-monitor/commit/60a9307d8e00b75c28f8e0b8a80f39f82ece0ccb))

## 2.0.0 - 2026-09-08

The v2 delta engine: status-change, amendment and closure detection, replacing the v1 retrofit's "always NEW_LISTING" limitation - see AGENTS.md "Delta engine v2" for the full technical reasoning.

### Added

- **`STATUS_CHANGE` events**: a tender whose `estado` changed since it was last seen is reported as `STATUS_CHANGE` with `previousEstado` set - free to detect, already in the walked row.
- **`UPDATED` events**: a tender whose content changed (a prorroga granted, an amended item/budget, a changed contact) while keeping the same estado is detected via a sha1 content fingerprint (`contentHash`).
- **`CLOSED` events**: a tender no longer present in the active listing is now detected and reported. Only computed against a COMPLETE walk (`maxItems` not truncating it) - a partial walk cannot prove absence, applying the same lesson salta-compras-monitor's build already documented.
- **`eventTypes` input**: narrows delta-mode delivery to a subset of `NEW_LISTING`/`STATUS_CHANGE`/`UPDATED`/`CLOSED`.
- `previousEstado` and `contentHash` output fields; a second dataset view ("Status changes & closures").
- Apache-2.0 `LICENSE`, this `CHANGELOG.md`, an `npx eslint .` step in CI.

### Changed

- **Delta state shape**: `src/state.ts` replaced the v1 bare `seenIds: string[]` with `entries: Record<nroCotizacion, {estado, hash, tipoContratacion, jurisdiccion}>`. **Not backward compatible**: a v1-shaped state is treated as absent, not migrated - an existing scheduled task's next run re-baselines.
- Pricing: two-tier PPE (`result` $0.003 for full-content events, `result-summary` $0.001 for CLOSED), replacing the v1 flat single-tier price.

### Not changed (on purpose)

- The stateful postback/cookie/ViewState session flow, the Residential+AR proxy fallback, and the Dockerfile's `NODE_EXTRA_CA_CERTS` TLS fix - all untouched, still exactly as hard-won in the original build.
- `dist/` stays gitignored - this actor's multi-stage Dockerfile builds it fresh from source, unlike the rest of the fleet's single-stage Dockerfiles (where un-gitignoring `dist/` was the correct fix). See AGENTS.md.
