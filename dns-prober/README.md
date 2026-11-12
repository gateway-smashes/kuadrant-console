# dns-prober

Companion service for the **kuadrant-console** plugin's DNS
Troubleshooting page. Answers cross-resolver DNS probes so the browser
(which has no DNS API) can render live "does this hostname resolve on
Cloudflare / Google / Quad9 / …" tables.

Optional. When it isn't installed, the plugin renders an EmptyState in
the resolver preview card pointing back to this README.

Lives in the plugin's repo so the whole ecosystem stays together — the
plugin depends on this being reachable at a configurable URL, so
shipping them alongside each other keeps the contract obvious.

## What it does

One endpoint:

```http
POST /api/probe
Content-Type: application/json

{
  "hostname": "banking-api.example.com",
  "resolvers": [
    {"name": "Cloudflare", "ip": "1.1.1.1"},
    {"name": "Google",     "ip": "8.8.8.8"}
  ]
}
```

```json
{
  "hostname": "banking-api.example.com",
  "results": [
    {"resolver": "Cloudflare", "status": "healthy", "answer": "A 54.222.18.10", "latencyMs": 42, "probedAt": "2026-07-09T20:15:00Z"},
    {"resolver": "Google",     "status": "failing", "answer": "NXDOMAIN",        "latencyMs": 15, "probedAt": "2026-07-09T20:15:00Z"}
  ]
}
```

Uses [dnsjava](https://github.com/dnsjava/dnsjava) to steer each query
at the requested resolver's IP directly. The JVM's built-in resolver
only ever queries whatever the pod's `/etc/resolv.conf` says, which is
not what we want for a cross-resolver preview.

`resolvers` on the request is optional — omit it and the service uses
its own 8-entry default (Cloudflare / Google / Quad9 / OpenDNS /
Verisign / Cisco OpenDNS / AdGuard / Yandex), the same list the plugin
sends by default.

Egress: the service opens UDP to `<resolver.ip>:53`. OpenShift default
egress allows that; locked-down clusters need a `NetworkPolicy`
whitelisting the resolver IPs on port 53.

## Install

```sh
./install.sh
```

That script:

1. `podman build` + `podman push` the image (defaults to
   `quay.io/gateway-smashes/kuadrant-console:dns-prober` —
   override with `IMAGE=<repo>`).
2. `oc apply -f deploy/dns-prober.yaml` (namespace `kuadrant-console`).
3. Waits for the rollout.
4. Patches the plugin's `kuadrant-console-config` ConfigMap with
   `dnsProberUrl: https://<route-host>`.
5. Restarts the plugin + Console so the URL is picked up.

Skip parts of the flow with `SKIP_BUILD=1` (reuse existing image) or
`SKIP_CONFIGMAP=1` (leave the ConfigMap alone — useful when the
operator manages that CM by hand).

## Verify

```sh
URL=$(oc -n kuadrant-console get route dns-prober -o jsonpath='https://{.spec.host}')

# health
curl -sk "$URL/q/health/ready"
# {"status":"UP","checks":[]}

# probe
curl -sk -X POST "$URL/api/probe" \
  -H "Content-Type: application/json" \
  -d '{"hostname":"kuadrant.io"}' | jq
```

Then open **Connectivity Link → DNS Troubleshooting** in Console.
Scroll to the *DNS resolution preview* card — the badge should now
read `Live` and the rows carry real per-resolver answers + latency.

## Uninstall

```sh
oc -n kuadrant-console delete deploy,svc,route,serviceaccount dns-prober
oc -n kuadrant-console patch cm kuadrant-console-config \
  --type=json -p='[{"op":"remove","path":"/data/dnsProberUrl"}]'
```

The plugin's resolver card goes back to the "install the companion"
EmptyState.

## Not included

- **Per-tenant auth.** The endpoint is open — a locked-down deploy
  should front it with an Istio `AuthorizationPolicy` limiting who
  can call it. On the demo lab we accept anything.
- **Historical probe cache.** Every plugin request triggers a fresh
  probe. Adding a small in-memory cache (say, 30 s TTL keyed by
  `hostname + resolver`) is a follow-up if the resolver load becomes
  visible.
