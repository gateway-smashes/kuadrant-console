import { K8sGroupVersionKind } from '@openshift-console/dynamic-plugin-sdk';

export const GatewayGVK: K8sGroupVersionKind = {
  group: 'gateway.networking.k8s.io',
  version: 'v1',
  kind: 'Gateway',
};

export const GatewayClassGVK: K8sGroupVersionKind = {
  group: 'gateway.networking.k8s.io',
  version: 'v1',
  kind: 'GatewayClass',
};

export const HTTPRouteGVK: K8sGroupVersionKind = {
  group: 'gateway.networking.k8s.io',
  version: 'v1',
  kind: 'HTTPRoute',
};

export const AuthPolicyGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1',
  kind: 'AuthPolicy',
};

export const RateLimitPolicyGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1',
  kind: 'RateLimitPolicy',
};

export const TokenRateLimitPolicyGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1alpha1',
  kind: 'TokenRateLimitPolicy',
};

export const DNSPolicyGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1',
  kind: 'DNSPolicy',
};

export const TLSPolicyGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1',
  kind: 'TLSPolicy',
};

export const PlanPolicyGVK: K8sGroupVersionKind = {
  group: 'extensions.kuadrant.io',
  version: 'v1alpha1',
  kind: 'PlanPolicy',
};

export const DNSRecordGVK: K8sGroupVersionKind = {
  group: 'kuadrant.io',
  version: 'v1alpha1',
  kind: 'DNSRecord',
};

export const CertificateGVK: K8sGroupVersionKind = {
  group: 'cert-manager.io',
  version: 'v1',
  kind: 'Certificate',
};

// cert-manager issuance chain — each Certificate spawns a
// CertificateRequest, which (for ACME issuers) spawns an Order that
// creates one or more Challenges. Errors bubble up through
// status.conditions on each step, so the TLS troubleshooting page
// watches them all and correlates by `metadata.ownerReferences`.
export const CertificateRequestGVK: K8sGroupVersionKind = {
  group: 'cert-manager.io',
  version: 'v1',
  kind: 'CertificateRequest',
};
export const OrderGVK: K8sGroupVersionKind = {
  group: 'acme.cert-manager.io',
  version: 'v1',
  kind: 'Order',
};
export const ChallengeGVK: K8sGroupVersionKind = {
  group: 'acme.cert-manager.io',
  version: 'v1',
  kind: 'Challenge',
};
// Namespaced vs cluster-scoped counterparts. The TLSPolicy usually
// references one of these by name — the plugin watches both and picks
// the matching one when rendering the Issuer node.
export const IssuerGVK: K8sGroupVersionKind = {
  group: 'cert-manager.io',
  version: 'v1',
  kind: 'Issuer',
};
export const ClusterIssuerGVK: K8sGroupVersionKind = {
  group: 'cert-manager.io',
  version: 'v1',
  kind: 'ClusterIssuer',
};
// tls.crt / tls.key live in a plain Secret; the Gateway listener
// references it by name. Filtered client-side to `type=kubernetes.io/tls`.
export const SecretGVK: K8sGroupVersionKind = {
  group: '',
  version: 'v1',
  kind: 'Secret',
};

export const ServiceGVK: K8sGroupVersionKind = {
  group: '',
  version: 'v1',
  kind: 'Service',
};

export const NamespaceGVK: K8sGroupVersionKind = {
  group: '',
  version: 'v1',
  kind: 'Namespace',
};

export const EndpointSliceGVK: K8sGroupVersionKind = {
  group: 'discovery.k8s.io',
  version: 'v1',
  kind: 'EndpointSlice',
};

export const APIProductGVK: K8sGroupVersionKind = {
  group: 'devportal.kuadrant.io',
  version: 'v1alpha1',
  kind: 'APIProduct',
};

export const APIKeyGVK: K8sGroupVersionKind = {
  group: 'devportal.kuadrant.io',
  version: 'v1alpha1',
  kind: 'APIKey',
};

// devportal.kuadrant.io/v1alpha1 — auto-created by the controller; the
// review/approval workflow points at *this*, not at APIKey directly.
export const APIKeyRequestGVK: K8sGroupVersionKind = {
  group: 'devportal.kuadrant.io',
  version: 'v1alpha1',
  kind: 'APIKeyRequest',
};

// devportal.kuadrant.io/v1alpha1 — created by the operator (or via this
// plugin) every time an APIKeyRequest is approved or rejected.
export const APIKeyApprovalGVK: K8sGroupVersionKind = {
  group: 'devportal.kuadrant.io',
  version: 'v1alpha1',
  kind: 'APIKeyApproval',
};

/**
 * The set of policy GVKs for which the console ships **specialized renderers**
 * (TLS expiry card, rate-limit RPS panel, etc.). This is NOT an exhaustive
 * inventory of attachable policies — for runtime enumeration of every policy
 * CRD on the cluster (BackendTLSPolicy on OCP 4.22, any future Kuadrant
 * policy), use `useDiscoveredPolicyCRDs()` which follows the Gateway API
 * GEP-713 label convention. New code that needs "every attached policy"
 * SHOULD call the discovery hook and treat unknown kinds via the
 * `GenericPolicy` renderer.
 */
export const ALL_POLICY_GVKS = [
  AuthPolicyGVK,
  RateLimitPolicyGVK,
  TokenRateLimitPolicyGVK,
  DNSPolicyGVK,
  TLSPolicyGVK,
];

export const POLICY_KIND_LABELS: Record<string, string> = {
  AuthPolicy: 'Auth',
  RateLimitPolicy: 'Rate Limit',
  TokenRateLimitPolicy: 'Token Rate Limit',
  DNSPolicy: 'DNS',
  TLSPolicy: 'TLS',
};

/**
 * Resolve the display label for a policy kind. Returns the curated short
 * label when one is registered in POLICY_KIND_LABELS (the 5 specialized
 * kinds) and falls back to the raw kind name for everything else — so
 * policies discovered at runtime (e.g. BackendTLSPolicy) get a sane label
 * without any further registration.
 */
export function policyKindLabel(kind: string): string {
  return POLICY_KIND_LABELS[kind] || kind;
}

const POLICY_KIND_TO_GVK: Record<string, K8sGroupVersionKind> = {
  AuthPolicy: AuthPolicyGVK,
  RateLimitPolicy: RateLimitPolicyGVK,
  TokenRateLimitPolicy: TokenRateLimitPolicyGVK,
  DNSPolicy: DNSPolicyGVK,
  TLSPolicy: TLSPolicyGVK,
};

// URL segment per kind for the plugin's operational policy pages. Falls
// back to the kind name lowercased for any policy discovered at runtime
// that doesn't have a dedicated route yet.
const POLICY_KIND_TO_PLUGIN_SLUG: Record<string, string> = {
  AuthPolicy: 'auth',
  RateLimitPolicy: 'ratelimit',
  TokenRateLimitPolicy: 'tokenratelimit',
  DNSPolicy: 'dns',
  TLSPolicy: 'tls',
};

/**
 * Plugin URL for the operational detail page of a policy. Used by every
 * widget that wants "click → operational policy view" (overview,
 * attachment view, list page, plans card). When the kind has no
 * dedicated plugin page, falls back to the native Console CR detail.
 */
export function policyResourceURL(policyKind: string, namespace: string, name: string): string {
  const slug = POLICY_KIND_TO_PLUGIN_SLUG[policyKind];
  if (slug) return `/connectivity-link/policies/${slug}/${namespace}/${name}`;
  const gvk = POLICY_KIND_TO_GVK[policyKind];
  if (!gvk) return '#';
  return `/k8s/ns/${namespace}/${gvk.group}~${gvk.version}~${gvk.kind}/${name}`;
}

export const GRPCRouteGVK: K8sGroupVersionKind = {
  group: 'gateway.networking.k8s.io',
  version: 'v1',
  kind: 'GRPCRoute',
};

// mcp.kuadrant.io — official Kuadrant MCP Gateway (Technology Preview).
// The RELEASED chart (0.7.x) serves **v1alpha1** only; `v1` exists on the
// project's main branch (with a v1alpha1→v1 migration guide) but is not yet in
// a release, so the deployed/served version — the one this plugin must watch —
// is v1alpha1. Bump to v1 when a release ships it.
// MCPServerRegistration registers a backend MCP server (targetRef → HTTPRoute)
// under a tool prefix; MCPGatewayExtension attaches the broker to a Gateway
// listener; MCPVirtualServer curates a subset of the federated tools.
export const MCPServerRegistrationGVK: K8sGroupVersionKind = {
  group: 'mcp.kuadrant.io',
  version: 'v1alpha1',
  kind: 'MCPServerRegistration',
};
export const MCPGatewayExtensionGVK: K8sGroupVersionKind = {
  group: 'mcp.kuadrant.io',
  version: 'v1alpha1',
  kind: 'MCPGatewayExtension',
};
export const MCPVirtualServerGVK: K8sGroupVersionKind = {
  group: 'mcp.kuadrant.io',
  version: 'v1alpha1',
  kind: 'MCPVirtualServer',
};
