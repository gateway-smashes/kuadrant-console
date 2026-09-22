# SkyLink Aviation Demo

A multi-API demo that populates every major view of the Connectivity Link
console with realistic flight data and live traffic.

## What's deployed

| API | Gateway | Endpoints | Traffic pattern |
|-----|---------|-----------|-----------------|
| Flight Search | `skylink-public-gateway` | `GET /flights`, `GET /schedules` | High read (60%) |
| Flight Tracker | `skylink-public-gateway` | `GET /positions`, `GET /status` | High throughput (25%) |
| Booking | `skylink-partner-gateway` | `GET/POST /reservations`, `GET /tickets` | Moderate (10%) |
| SkyMiles Loyalty | `skylink-partner-gateway` | `GET /members`, `POST /redeem` | Low (5%) |

### Policies

- **AuthPolicy** on each gateway (API key auth)
- **RateLimitPolicy** — gateway-level (500/min public) + route-level overrides
  (1000/min tracker, 30/min booking writes, 50/min loyalty)
- **TLSPolicy** on both gateways (cert-manager / Let's Encrypt)
- **DNSPolicy** on both gateways

### API Products & Keys

4 API Products (3 Published, 1 Draft) with Free/Pro/Enterprise plans.
7 API Keys in mixed states: 3 Approved, 3 Pending, 1 Rejected.

### Traffic Generator

A lightweight pod that continuously hits all four backend services at
~15–20 req/s total, with weighted distribution matching realistic usage
patterns. Metrics appear in Prometheus panels within ~60 seconds.

## Prerequisites

- OpenShift 4.19+ with the Kuadrant operator (RHCL) installed
- `oc` logged in with cluster-admin
- cert-manager (for TLS policies)
- User-workload monitoring enabled (optional — metrics panels degrade
  gracefully without it)

## Setup

```bash
./demo-skylink/setup.sh
```

This applies all resources in order, waits for backend pods to be ready,
patches status subresources, and starts the traffic generator.

## Teardown

```bash
./demo-skylink/teardown.sh
```

## Console views exercised

| Console view | What you'll see |
|---|---|
| **Overview** | 2 gateways, 4 routes, environment health, traffic sparklines |
| **Gateways** | Public vs partner gateway, listener hostnames, policy counts |
| **Gateway Detail** | Ops dashboard with live traffic, security score, topology |
| **HTTPRoutes** | 4 routes with hostnames, backend health indicators |
| **Policies** | Auth, rate-limit, TLS, DNS across both gateways — effective stack resolution |
| **Topology** | 2 gateways → 4 routes → 4 services with policy decorations |
| **API Products** | 4 products with plans, traffic charts, auth status |
| **API Keys** | 7 keys showing approve/reject workflow |
| **DNS Overview** | 2 DNS policies with propagation status |
| **TLS Overview** | 2 TLS policies with certificate lifecycle |
| **Cost Monitoring** | Per-consumer traffic breakdown |
