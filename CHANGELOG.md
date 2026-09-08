# Changelog

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
