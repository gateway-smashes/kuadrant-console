#!/usr/bin/env bash
#
# Patches status subresources that cannot be set via oc apply.
# Run after: oc apply -f demo-skylink/
#
set -euo pipefail

NS="skylink-demo"

echo "=== Patching APIProduct statuses ==="

oc patch apiproduct skylink-flight-search -n "$NS" \
  --type merge --subresource=status \
  --patch '{
    "status": {
      "discoveredPlans": [
        {"tier": "Free",       "limits": {"daily": 1000}},
        {"tier": "Pro",        "limits": {"daily": 50000, "monthly": 1000000}},
        {"tier": "Enterprise", "limits": {"daily": 500000, "monthly": 10000000}}
      ],
      "discoveredAuthScheme": {
        "type": "API Key",
        "required": true
      },
      "conditions": [
        {"type": "Ready", "status": "True", "reason": "Reconciled", "message": "API product is published and available", "lastTransitionTime": "2026-08-25T10:00:00Z"}
      ]
    }
  }'

oc patch apiproduct skylink-flight-tracker -n "$NS" \
  --type merge --subresource=status \
  --patch '{
    "status": {
      "discoveredPlans": [
        {"tier": "Free",       "limits": {"daily": 5000}},
        {"tier": "Pro",        "limits": {"daily": 100000, "monthly": 2000000}},
        {"tier": "Enterprise", "limits": {"daily": 1000000}}
      ],
      "discoveredAuthScheme": {
        "type": "API Key",
        "required": true
      },
      "conditions": [
        {"type": "Ready", "status": "True", "reason": "Reconciled", "message": "API product is published and available", "lastTransitionTime": "2026-08-25T10:00:00Z"}
      ]
    }
  }'

oc patch apiproduct skylink-booking -n "$NS" \
  --type merge --subresource=status \
  --patch '{
    "status": {
      "discoveredPlans": [
        {"tier": "Pro",        "limits": {"daily": 10000, "monthly": 200000}},
        {"tier": "Enterprise", "limits": {"daily": 100000, "monthly": 2000000}}
      ],
      "discoveredAuthScheme": {
        "type": "API Key",
        "required": true
      },
      "conditions": [
        {"type": "Ready", "status": "True", "reason": "Reconciled", "message": "API product is published and available", "lastTransitionTime": "2026-08-25T10:00:00Z"}
      ]
    }
  }'

oc patch apiproduct skylink-loyalty -n "$NS" \
  --type merge --subresource=status \
  --patch '{
    "status": {
      "discoveredPlans": [
        {"tier": "Pro",     "limits": {"daily": 5000, "monthly": 100000}},
        {"tier": "Enterprise", "limits": {"daily": 50000, "monthly": 1000000}}
      ],
      "discoveredAuthScheme": {
        "type": "API Key",
        "required": true
      },
      "conditions": [
        {"type": "Ready", "status": "False", "reason": "Draft", "message": "API product is in draft status", "lastTransitionTime": "2026-08-25T10:00:00Z"}
      ]
    }
  }'

echo "=== Patching APIKey statuses ==="

# Flight Search keys — auto-approved
oc patch apikey skylink-key-acme-travel -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Approved", "reviewedAt": "2026-08-20T09:00:00Z", "reviewedBy": "system"}}'

oc patch apikey skylink-key-wanderlust -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Approved", "reviewedAt": "2026-08-22T14:30:00Z", "reviewedBy": "system"}}'

# Flight Tracker keys — one approved, one pending
oc patch apikey skylink-key-airport-displays -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Approved", "reviewedAt": "2026-08-18T11:00:00Z", "reviewedBy": "admin"}}'

oc patch apikey skylink-key-flightradar -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Pending"}}'

# Booking keys — one approved, one pending
oc patch apikey skylink-key-travelport -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Approved", "reviewedAt": "2026-08-15T16:00:00Z", "reviewedBy": "admin"}}'

oc patch apikey skylink-key-startup-ota -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Pending"}}'

# Loyalty key — rejected
oc patch apikey skylink-key-hotel-partner -n "$NS" \
  --type merge --subresource=status \
  --patch '{"status": {"phase": "Rejected", "reviewedAt": "2026-08-24T09:30:00Z", "reviewedBy": "admin"}}'

echo "=== Done. All status subresources patched. ==="
