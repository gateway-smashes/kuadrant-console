# Release Notes — Custom RHCL Console

## v1.5.1 — 2026-08-05

Image: `quay.io/gateway-smashes/kuadrant-console:1.5.1` (`linux/amd64`)

### Fixes
- **Overview summary cards**: the status breakdown row (Healthy / Critical /
  Warning / Enforced / Accepted / Overridden / Detected / Published / Draft /
  Deprecated …) now shows its **count** next to each label. The counts were
  computed all along — `EnvironmentHealthCard` was rendering the dot + label but
  dropping `breakdown.count`, so every legend read as a bare label with no
  number.

## v1.5.0 — 2026-07-31

Image: `quay.io/hodrigohamalho/kuadrant-console:1.5.0`

The AI-gateway story, made interactive.

### Highlights

**AI Gateway lens (`/connectivity-link/ai-gateway`)**
- New page over a Kuadrant **TokenRateLimitPolicy**: KPIs (token rate, a
  **token-budget gauge** vs the policy limit, AI requests, throttled 429s,
  consumers, cost), the policy card (limit / path / enforcement / consumed vs
  budget), a per-consumer table, and a token-throughput trend.
- **Try it** — an in-console chat playground: pick a consumer, send a real
  OpenAI-compatible chat completion **through the gateway** (auth +
  TokenRateLimitPolicy apply) via a new `ai-chat` plugin proxy, and watch the
  `usage` tokens come back — or a **live 429** when the shared per-minute token
  budget is exhausted. A session counter tallies calls + tokens spent.
- "Real-only, honest gaps": token throughput + budget + throttling are real;
  per-consumer *requests* are real (istio `x-consumer-id`); per-consumer *token*
  split is shown as N/A (the app reports usage globally as `anonymous`).

**Observability menu — fix**
- Grafana deep-links in the consolidated Observability dropdown now open
  (`window.open`); PF v6 `DropdownItem` was swallowing the anchor click.

## v1.4.0 — 2026-07-29

Image: `quay.io/hodrigohamalho/kuadrant-console:1.4.0`

MCP Gateway support plus a shift from resource viewers to **operational
dashboards**. "Real-only, honest gaps": every value is derived from live
cluster / Prometheus / cert-manager / DNS / broker state; unmeasurable signals
render as greyed **N/A** and never affect a score.

### Highlights

**MCP Gateway (`mcp.kuadrant.io/v1alpha1`, Technology Preview)**
- MCP Servers list + detail pages, the **Add MCP Gateway** guided wizard, and an
  in-console **try-it playground** that reaches the broker through the console
  proxy (`initialize → tools/list → tools/call` over Streamable HTTP).
- MCP Server detail is an operations dashboard: KPIs (Tools / Prompts / backend
  endpoints), Registration + Health, a Client → Broker → Server → Route →
  Service → Pods topology, a live tools catalog with per-tool **Try**, and a
  Prompts panel.

**Gateway detail → Operations Dashboard**
- KPI row (Listeners / Routes / Backends / Policies / Traffic / Errors /
  **Security score**), Gateway Health + Security Posture + Traffic grid, a
  topology card-flow, listeners table, policy coverage, live needs-attention
  alerts, capacity, DNS/TLS health, collapsed deep-dives + Advanced details.
- **Security score** is a transparent weighted formula over real signals
  (auth / rate-limit / TLS / DNS / reconciliation); WAF + security headers are
  shown but excluded from the denominator (not measurable here).

**Reusable Observability menu**
- One consolidated Grafana / Tempo / Alerts dropdown (`common/ObservabilityMenu`),
  now shared by the Gateway, HTTPRoute, API Product and MCP Server pages.

**API keys**
- Real approval gate driven by the Authorino `managed-by` label on the key
  Secret (the fast, actually-reconciled signal), not the approval CR.

**Shared building blocks**
- `common/kpi` (KpiCard / RadialRing / Delta / Sparkline / Donut) and
  `common/dashboardCards` (SectionCard / MetricGrid / Metric / N/A cell) back
  both the cost page and the new dashboards.

## v1.3.0 — 2026-07-10

Image: `quay.io/jsimas/kuadrant-console:1.3.0`

Everything below landed since the 1.2 image (package tree 0.1.0),
including the merge of the
`feat/overview-operational-dashboard` line and the TLS/DNS operational pages.

### Highlights

**Overview — operational dashboard**
- Overview page rebuilt around real cluster data (mock data removed):
  environment health, gateway operational cards, needs-attention panel,
  policy impact table, route/backend traffic and recent events.
- Namespace filter (`?namespace=`) — bookmarkable, cached in localStorage.
- Gateway data-plane pod health surfaced next to the Kuadrant CR view
  (restart storms, sustained not-ready, recent Warning events).

**TLS**
- New **TLS Overview** page — certificate health control tower across
  gateways (expiry, issuer, listener/cert mismatches), preferring the
  HTTPS listener.
- New **TLS Troubleshooting** page — end-to-end lifecycle view, backed by a
  live HTTPS handshake probe on the dns-prober companion service.

**DNS**
- New **DNS Troubleshooting** page: real DNSRecord state, cross-resolver
  table (via the optional external prober), region-grouped resolver view,
  multi-site co-ownership detection (tells single-cluster ELB round-robin
  apart from real multi-site), Grafana/Prometheus links.
- Companion **dns-prober** (Quarkus) service moved into this repo; serves
  HTTPS on 8443 for the ConsolePlugin proxy and ships in the same Quay repo.

**Policies**
- Per-policy detail pages: AuthPolicy, DNSPolicy, TLSPolicy,
  TokenRateLimitPolicy — plus the existing RateLimitPolicy — on a shared
  layout (summary, operational status, affected resources, troubleshooting).
- "Partially enforced" is now explained: covered vs overshadowed routes.
- RateLimit forms expose the actual counter/predicate CEL.

**Create / Edit / Delete (CRUD)**
- Create + Edit for Gateway / HTTPRoute / policy CRs via a shared editor
  modal (guided form + YAML tabs); delete with confirmation on every CR,
  using the same K8sModel shape as create (fixes opaque 404s).
- **API Publishing Wizard** (`/connectivity-link/create-api`) with OpenAPI
  import, YAML preview and AuthPolicy/RateLimitPolicy steps.
- GRPCRoutes list page.

**Cost Monitoring (BETA)**
- Per-consumer usage over 24h with tier pricing read from a ConfigMap
  (req018), including AI token accounting.

**Integrations**
- Runtime config via ConfigMap — point deep links at the customer's
  Grafana / Tempo without rebuilding the image.
- "Open in Grafana" deep links across detail pages; "View trace" deep links
  into Tempo; Tempo trace search from API product pages.
- Optional sidebar links: customer Developer Portal and Internal Developer
  Hub (req029) — both gated by feature flags driven by the ConfigMap.

### Fixes & polish
- i18n: repaired keys mangled/zeroed by i18next-parser and added the 152
  keys missing after the dashboard merge (namespace filter, cost page,
  nav section) — no more missing-key spam in the browser console.
- Navigation stays inside the plugin after create/delete (no more full
  console page loads); `.rhcl-plugin-root` dark surface kept on all
  loading/early-return paths (no black flash).
- Victory chart widths pinned to their container; metric labels readable.
- Grafana deep links land on the right dropdown entry (dropped trailing `.*`).
- HTTPRoute status read across **all** parent gateways, not just the first.

### Compatibility
- Built with `@openshift-console/dynamic-plugin-sdk` 4.21 — targets
  OpenShift Console 4.21 (validated locally against `origin-console:4.21`
  and cluster 4.21.19).
- React 18 / react-router 7 (+ v5-compat shims federated by the console).

---

## v1.0–1.2 (package 0.1.0) — 2026-05/06

Initial series: Gateways, HTTPRoutes, Policies and API Products list/detail
pages, topology view, API keys and plans, Grafana-backed traffic panels.
