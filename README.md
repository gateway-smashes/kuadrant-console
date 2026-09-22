<div align="center">

# Kuadrant Console

**An opinionated OpenShift Console plugin for [Red Hat Connectivity Link](https://docs.kuadrant.io) (RHCL / Kuadrant).**

API management, AI gateways and MCP — told in the language of the people who run them.

![OpenShift 4.19+](https://img.shields.io/badge/OpenShift-4.19%2B-EE0000)
![PatternFly 6](https://img.shields.io/badge/PatternFly-6-004080)
![License Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-3DA639)

</div>

![Gateway operations dashboard](./docs/images/gateway-detail.png)

---

## Why this exists

RHCL / Kuadrant is a powerful engine — Gateways, HTTPRoutes, AuthPolicies,
RateLimitPolicies, TokenRateLimitPolicies, DNS and TLS — but it hands you those
primitives as raw Kubernetes CRs, with no opinion about how they fit together.
Even a simple question — *"how do I identify a consumer?"* — takes real
expertise to answer from YAML alone.

**Kuadrant Console adds the opinion.** It re-frames those primitives into views
that API owners, developers and SREs recognize on sight — API Products,
operational dashboards, cost, an AI-gateway lens, MCP servers — so a customer
can *see* what the platform is doing, simply and practically. It invents
nothing new on the cluster; it organizes what Kuadrant already exposes.

> **Real-only, honest gaps.** Every value is computed from live cluster,
> Prometheus, cert-manager and DNS state. Signals that genuinely can't be
> measured render as a greyed **N/A** — never faked, never counted against a
> health score. That keeps the picture credible to a technical audience.

It's **read-only first** and carries **no service-account of its own**: every
API call rides the signed-in user's bearer token, so people see exactly what
their cluster RBAC allows — nothing more.

## What's inside

| Area | Screens |
|---|---|
| **API management** | API Products · API Overview (address, paths, plans, auth, traffic, keys) · Plans · API Keys with approve / reject · guided **Create-API wizard** · Developer Portal link |
| **Operations** | Environment **Overview** · Gateway **operations dashboard** (health, security score, topology, capacity) · HTTPRoutes & GRPCRoutes with backend health · Policy coverage & effective-stack resolution |
| **AI & MCP** | **AI Gateway lens** — token governance, throttling, per-consumer cost, live chat playground · **MCP Servers** — catalog, tools/prompts, in-console try-it |
| **Reliability** | **DNS** Overview + Troubleshooting · **TLS** Overview + Troubleshooting (expiry, issuer, chain) · **Cost Monitoring** per consumer |
| **Everywhere** | RBAC-aware empty states (explain the missing permission, no 403 toasts) · the API-owner views never expose YAML |

See [`SPECIFICATION.md`](SPECIFICATION.md) for the full requirements
(FR-001 – FR-026, NFR-001 – NFR-011).

## Screenshots

|  |  |
|---|---|
| **API Product Overview** | **HTTPRoute — backends** |
| ![API Product Overview](./docs/images/api-product-overview.png) | ![HTTPRoute Backends](./docs/images/httproute-backends.png) |
| **HTTPRoute detail** | **Cost Monitoring** |
| ![HTTPRoute Detail](./docs/images/httproute-detail.png) | ![Cost Monitoring](./docs/images/cost-monitoring.png) |

## Quick start

**Prerequisites:** OpenShift 4.19+, the Kuadrant operator (RHCL) with at least
one Gateway, and `oc`. User-workload monitoring is optional — metric panels
degrade gracefully without it.

```bash
# 1. Build & push the plugin image (nginx serving the webpack bundle).
#    Skip this and use the published image if you don't need a custom build:
#      quay.io/gateway-smashes/kuadrant-console:1.5.1
#    --platform matters: OpenShift nodes are x86-64, and podman on an Apple
#    Silicon Mac defaults to arm64, which the cluster cannot run.
cd console-plugin
podman build --platform linux/amd64 -t quay.io/<org>/kuadrant-console:latest .
podman push  quay.io/<org>/kuadrant-console:latest

# 2. Deploy the plugin server + register + enable it
#    (full manifests, TLS notes and verification in docs/deployment.md)
oc new-project kuadrant-console
# … apply the Service + Deployment + ConsolePlugin (see docs/deployment.md) …
oc patch console.operator.openshift.io cluster --type=json \
  --patch='[{"op":"add","path":"/spec/plugins/-","value":"kuadrant-console"}]'
```

The Console reloads and a **Connectivity Link** section appears in the admin
navigation. The plugin serves over **HTTPS on port 9001** with a
service-CA-signed certificate — the single most common first-time mistake is
deploying it over plain HTTP, which surfaces as *"Failed to get a valid plugin
manifest"*. The full, copy-pasteable deployment (with that TLS mount) lives in
**[docs/deployment.md](docs/deployment.md)**.

> The plugin registers with the Console under the technical name
> `kuadrant-console`; **Kuadrant Console** is its product name.

## Configuration

Deep links to Grafana / Tempo, and optional sidebar links (Developer Portal,
Internal Developer Hub) are driven at runtime by a ConfigMap — no rebuild
needed. Everything is optional and falls back to sensible defaults.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kuadrant-console-config
  namespace: kuadrant-console
data:
  grafanaNamespace: monitoring
  grafanaRouteName: grafana
  tempoNamespace: tempo
  developerPortalUrl: https://developer-portal.example.com   # omit to hide the item
```

Full field reference, API-key Secrets and feature flags → **[docs/configuration.md](docs/configuration.md)**.

## Demo: SkyLink Aviation Platform

A batteries-included demo that deploys a realistic **flight-data platform**
across two gateways with live traffic, so every console view has real data.

| API | Gateway | What it does |
|---|---|---|
| Flight Search | `skylink-public-gateway` | Routes, schedules, availability |
| Flight Tracker | `skylink-public-gateway` | Real-time positions and ETAs |
| Booking | `skylink-partner-gateway` | Reservations and e-tickets |
| SkyMiles Loyalty | `skylink-partner-gateway` | Frequent flyer tiers and redemption |

Includes 4 API Products with Free/Pro/Enterprise plans, 7 API Keys in
mixed approval states, full policy coverage (Auth, RateLimit, TLS, DNS),
and a traffic generator pushing ~15–20 req/s so Prometheus panels light up.

```bash
# Deploy everything
./demo-skylink/setup.sh

# Tear it all down
./demo-skylink/teardown.sh
```

Full details in **[demo-skylink/README.md](demo-skylink/README.md)**.
A simpler single-API demo (Petstore) is also available in **[demo/](demo/)**.

## Documentation

| Doc | What's in it |
|---|---|
| [**Architecture**](docs/architecture.md) | How the plugin works — dynamic-plugin model, data sources, the "real-only" philosophy, component & hook map, the RBAC model |
| [**Deployment**](docs/deployment.md) | Full deploy manifests, TLS/service-CA, verification, removal, first-time troubleshooting |
| [**Configuration**](docs/configuration.md) | Runtime ConfigMap, Grafana/Tempo/portal links, API-key Secrets, proxy aliases |
| [**Contributing**](docs/CONTRIBUTING.md) | Local dev, build & test, coding conventions, how to open a change |
| [**Specification**](SPECIFICATION.md) | Authoritative requirements — every change cites an FR/NFR |

## Technology stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5.x (strict) |
| UI | React 18 · PatternFly 6 |
| Plugin SDK | `@openshift-console/dynamic-plugin-sdk` 4.x |
| Bundler | Webpack 5 (module federation) |
| Charts / topology | `@patternfly/react-charts` · `@patternfly/react-topology` |
| i18n | `react-i18next` (English; structured for pt-BR) |
| Tests | Jest + React Testing Library |
| Runtime image | `ubi9/nginx` serving the static bundle over HTTPS |

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
