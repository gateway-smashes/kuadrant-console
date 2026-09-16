#!/usr/bin/env bash
#
# SkyLink Aviation Demo — full setup
#
# Prerequisites:
#   - oc logged in to an OpenShift 4.19+ cluster with the Kuadrant operator
#   - Cluster has cert-manager and user-workload monitoring (optional but recommended)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  SkyLink Aviation Platform — Demo Setup"
echo "============================================"
echo ""

# 1. Namespace
echo "[1/6] Creating namespace..."
oc apply -f "$SCRIPT_DIR/00-namespace.yaml"

# 2. Backend services
echo "[2/6] Deploying backend services..."
oc apply -f "$SCRIPT_DIR/backends/"

echo "       Waiting for backends to be ready..."
for deploy in flight-search-svc flight-tracker-svc booking-svc loyalty-svc; do
  oc rollout status deployment/"$deploy" -n skylink-demo --timeout=120s
done

# 3. Gateways
echo "[3/6] Creating gateways..."
oc apply -f "$SCRIPT_DIR/10-gateways.yaml"

# 4. HTTPRoutes + Policies
echo "[4/6] Creating routes and policies..."
oc apply -f "$SCRIPT_DIR/20-httproutes.yaml"
oc apply -f "$SCRIPT_DIR/30-policies.yaml"

# 5. API Products + Keys
echo "[5/6] Creating API products and keys..."
oc apply -f "$SCRIPT_DIR/40-api-products.yaml"
oc apply -f "$SCRIPT_DIR/50-api-keys.yaml"

echo "       Patching status subresources..."
"$SCRIPT_DIR/patch-status.sh"

# 6. Traffic generator
echo "[6/6] Starting traffic generator..."
oc apply -f "$SCRIPT_DIR/traffic-gen/"

echo ""
echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Namespace:   skylink-demo"
echo "  Gateways:    skylink-public-gateway"
echo "               skylink-partner-gateway"
echo "  APIs:        Flight Search, Flight Tracker,"
echo "               Booking, SkyMiles Loyalty"
echo "  API Keys:    7 keys (3 approved, 3 pending,"
echo "               1 rejected)"
echo "  Traffic:     ~15-20 req/s continuous"
echo ""
echo "  Open the OpenShift Console and navigate to"
echo "  Connectivity Link to see everything."
echo "============================================"
