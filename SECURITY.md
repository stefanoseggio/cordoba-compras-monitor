# Security Policy

## Supported versions

This Actor follows [semantic versioning](https://semver.org/) via automated release tagging (see [`.github/workflows/release.yml`](.github/workflows/release.yml)). Only the latest published major version receives security fixes — there is no long-term-support branch for older majors, consistent with this being a single-maintainer, independently-operated Actor rather than an enterprise product with a formal support matrix.

## Reporting a vulnerability

**Preferred: GitHub Private Vulnerability Reporting.** This repository has private vulnerability reporting enabled — go to the **Security** tab → **Report a vulnerability** to open a private advisory visible only to the maintainer until a fix is ready. This is the correct channel for anything that shouldn't be disclosed in a public issue (proxy/network handling risks, dependency CVEs affecting this Actor's real usage, etc.).

**Do not** open a public GitHub issue for a suspected security vulnerability — use private reporting instead so the disclosure stays coordinated.

## What's actually in scope

This Actor's real attack surface, honestly assessed:

- **No third-party API key or BYOK secret.** This Actor requires no customer-supplied credential (see the README's Cost & BYOK Disclosure section) — there is no customer secret this Actor could leak.
- **It does require a paid Residential + Argentina Apify Proxy group.** The source (`webecommerce.cba.gov.ar`) blocks non-residential, non-Argentina traffic at the network level, so this proxy group is defaulted automatically even if `proxyConfiguration` is omitted. It is billed through the user's own Apify platform usage, not a separate third-party credential supplied by the user.
- **No user-supplied code execution.** Input is a fixed JSON schema (`maxItems`, `onlyNew`, `eventTypes`, `dateRange`, `proxyConfiguration`) — there is no arbitrary-code or arbitrary-URL input surface.
- **Dependency vulnerabilities** in `package.json`'s real dependency tree (`apify`, `cheerio`, `impit`, and dev dependencies) are a real, ongoing concern — tracked via Dependabot (`.github/dependabot.yml`) and GitHub's own dependency/secret scanning, both enabled on this repository.
- **TLS chain handling.** The source's server sends an incomplete certificate chain. The Actor's `impit`-based HTTP transport validates the chain correctly on its own by default (live-verified against the real source — see AGENTS.md's "HTTP transport: impit" section), rather than disabling certificate validation; `impit` has no equivalent of the earlier Node-native `NODE_EXTRA_CA_CERTS` fix, only a blanket "ignore TLS errors" toggle, which is deliberately left unset. A compromised or spoofed source endpoint is outside this Actor's control.

## Response expectations

This is an independently developed and maintained Actor with no contractual security SLA. In practice, security reports are typically triaged within 48 hours — the same disclosed norm as this Actor's general support triage (see the README's Known limitations section) — though there is no guaranteed fix timeline. Reports that turn out to be genuine, exploitable vulnerabilities will be credited in the fix's release notes unless the reporter requests otherwise.

## Enterprise / institutional customers

If your organization requires a signed security addendum, a formal disclosure SLA, or a security questionnaire completed as part of procurement, open an issue against this Actor's [Store page](https://apify.com/stefano_seggio/cordoba-compras-monitor) or connect via [LinkedIn](https://www.linkedin.com/in/stefanoseggio-deltaregistry) — these are handled case-by-case, not something this file can commit to on Stefano's behalf.
