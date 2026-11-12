#!/usr/bin/env bash
# Install/reinstall the dns-prober companion into the cluster the
# current `oc` context points at. Mirrors what a customer would do
# manually:
#
#   1. Build the container image locally (podman).
#   2. Push it to a registry the cluster can pull from (default: the
#      hodrigohamalho quay account the plugin already uses).
#   3. Apply the Deployment / Service / Route manifests.
#   4. Patch the plugin ConfigMap with `dnsProberUrl` so the DNS
#      Troubleshooting page swaps its EmptyState for real data.
#   5. Restart the plugin + Console pods so the URL is picked up.
#
# Overrides:
#   IMAGE=<repo>       — override the target image; defaults to
#                        quay.io/gateway-smashes/kuadrant-console:dns-prober
#   SKIP_BUILD=1       — reuse whatever the image tag currently points at
#   SKIP_CONFIGMAP=1   — apply/patch nothing on the ConfigMap (useful
#                        when the operator manages that CM by hand)

set -euo pipefail

IMAGE="${IMAGE:-quay.io/gateway-smashes/kuadrant-console:dns-prober}"
NAMESPACE="${NAMESPACE:-kuadrant-console}"
CONFIGMAP="${CONFIGMAP:-kuadrant-console-config}"
CONFIGMAP_NAMESPACE="${CONFIGMAP_NAMESPACE:-kuadrant-console}"

here=$(cd "$(dirname "$0")" && pwd)

echo "================================================================"
echo "  dns-prober install"
echo "  image     : $IMAGE"
echo "  namespace : $NAMESPACE"
if [[ -z "${SKIP_CONFIGMAP:-}" ]]; then
  echo "  configmap : $CONFIGMAP_NAMESPACE/$CONFIGMAP"
fi
echo "================================================================"

if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "→ building image (podman)"
  podman build --platform linux/amd64 -t "$IMAGE" -f "$here/Dockerfile" "$here"
  echo "→ pushing"
  podman push "$IMAGE"
else
  echo "→ SKIP_BUILD=1 set, reusing existing image at $IMAGE"
fi

echo "→ applying manifests"
oc apply -f "$here/deploy/dns-prober.yaml"

echo "→ waiting for rollout"
oc -n "$NAMESPACE" rollout status deploy/dns-prober --timeout=180s

ROUTE_HOST=$(oc -n "$NAMESPACE" get route dns-prober -o jsonpath='{.spec.host}')
if [[ -z "$ROUTE_HOST" ]]; then
  echo "✗ Could not read Route host — is the Route object present?"
  exit 1
fi
PROBER_URL="https://$ROUTE_HOST"
echo "✓ dns-prober is up at $PROBER_URL"

if [[ -z "${SKIP_CONFIGMAP:-}" ]]; then
  echo "→ patching $CONFIGMAP_NAMESPACE/$CONFIGMAP with dnsProberUrl"
  oc -n "$CONFIGMAP_NAMESPACE" patch cm "$CONFIGMAP" \
    --type=merge -p "{\"data\":{\"dnsProberUrl\":\"$PROBER_URL\"}}"

  echo "→ restarting plugin + Console so the URL is picked up"
  oc -n "$CONFIGMAP_NAMESPACE" rollout restart deploy/kuadrant-console
  oc -n openshift-console rollout restart deploy/console
  oc -n "$CONFIGMAP_NAMESPACE" rollout status deploy/kuadrant-console --timeout=180s
  oc -n openshift-console rollout status deploy/console --timeout=180s
else
  echo "→ SKIP_CONFIGMAP=1 set — remember to add dnsProberUrl=$PROBER_URL"
  echo "  to your $CONFIGMAP_NAMESPACE/$CONFIGMAP ConfigMap manually"
fi

echo ""
echo "Sanity check:"
echo "  curl -sk $PROBER_URL/q/health/ready"
echo "  curl -sk -X POST $PROBER_URL/api/probe \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"hostname\":\"kuadrant.io\"}' | jq"
echo ""
echo "Open the plugin: Connectivity Link → DNS Troubleshooting."
echo "The 'DNS resolution preview' card now shows 'Live' instead of the empty state."
