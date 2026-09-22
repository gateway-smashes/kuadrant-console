#!/usr/bin/env bash
#
# SkyLink Aviation Demo — clean removal
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Removing SkyLink demo resources..."

# Delete in reverse order to avoid dangling references
oc delete -f "$SCRIPT_DIR/traffic-gen/" --ignore-not-found
oc delete -f "$SCRIPT_DIR/50-api-keys.yaml" --ignore-not-found
oc delete -f "$SCRIPT_DIR/40-api-products.yaml" --ignore-not-found
oc delete -f "$SCRIPT_DIR/30-policies.yaml" --ignore-not-found
oc delete -f "$SCRIPT_DIR/20-httproutes.yaml" --ignore-not-found
oc delete -f "$SCRIPT_DIR/10-gateways.yaml" --ignore-not-found
oc delete -f "$SCRIPT_DIR/backends/" --ignore-not-found
oc delete -f "$SCRIPT_DIR/00-namespace.yaml" --ignore-not-found

echo "Done. All SkyLink demo resources removed."
