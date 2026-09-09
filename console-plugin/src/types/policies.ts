import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import { K8sCondition, PolicyTargetReference } from './common';

export interface AuthRuleWhen {
  selector: string;
  operator: string;
  value?: string;
}

export interface AuthCredentials {
  authorizationHeader?: {
    prefix?: string;
  };
  customHeader?: {
    name: string;
  };
  queryString?: {
    name: string;
  };
  cookie?: {
    name: string;
  };
}

export interface AuthIdentity {
  apiKey?: {
    selector: {
      matchLabels?: Record<string, string>;
    };
    allNamespaces?: boolean;
  };
  jwt?: {
    issuerUrl?: string;
    audiences?: string[];
  };
  oauth2?: Record<string, unknown>;
  oidc?: {
    endpoint: string;
    credentials?: AuthCredentials;
  };
  anonymous?: Record<string, unknown>;
  kubernetesTokenReview?: {
    audiences?: string[];
  };
  plainIdentity?: {
    selector: string;
  };
  credentials?: AuthCredentials;
  when?: AuthRuleWhen[];
  cache?: { key: { selector: string }; ttl?: number };
}

export interface AuthRules {
  authentication?: Record<string, AuthIdentity>;
  authorization?: Record<string, unknown>;
  response?: Record<string, unknown>;
  callbacks?: Record<string, unknown>;
}

export interface AuthPolicySpec {
  rules?: AuthRules;
  when?: AuthRuleWhen[];
}

export interface AuthPolicy extends K8sResourceCommon {
  spec: {
    // GEP-2649: targetRefs[] is the current Gateway API form. The singular
    // targetRef is retained for back-compat with policies that have not migrated.
    // Callers SHOULD use policyTargetRefs(p) / policyAttachesTo(p, ...) from
    // utils/policyTargets instead of reading either field directly.
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    defaults?: AuthPolicySpec;
    overrides?: AuthPolicySpec;
    rules?: AuthRules;
    when?: AuthRuleWhen[];
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

/**
 * A rate-limit counter key. Two forms exist in the wild (mirroring `when`):
 *   - Legacy string form: "auth.identity.userid"
 *   - CEL object form (Kuadrant v1+): { expression: "auth.identity.userid" }
 * The object form is what the cluster emits today. Use counterText() to render
 * or match either form as a string.
 */
export type RateLimitCounter = string | { expression?: string };

export interface RateLimit {
  // Sometimes omitted (unlimited tier) — the visualizer treats absent/empty
  // rates as "Unlimited" rather than as "broken policy".
  rates?: {
    limit: number;
    window: string;
  }[];
  // Counter keys. Legacy string form or CEL object form { expression } (v1+).
  // Use counterText() to render/match either. See RateLimitCounter.
  counters?: RateLimitCounter[];
  // Two forms exist in the wild:
  //   - Legacy expression form: { selector, operator, value }
  //   - CEL form (Kuadrant v1+):  { predicate: "auth.kuadrant.plan == 'gold'" }
  // The CEL form is what the cluster actually emits today; the legacy form
  // is kept only for back-compat with older policies.
  when?: ({
    selector: string;
    operator: string;
    value?: string;
  } | {
    predicate: string;
  })[];
}

/**
 * Normalise a rate-limit counter (string or `{ expression }`) to its text form
 * for display and matching. Prevents rendering the raw object as a React child
 * (which throws — see the v1 object-counter regression) and stops it
 * stringifying to "[object Object]" in labels.
 */
export function counterText(counter: RateLimitCounter | undefined | null): string {
  if (counter == null) return '';
  return typeof counter === 'string' ? counter : counter.expression ?? '';
}

export interface RateLimitPolicySpec {
  limits?: Record<string, RateLimit>;
  when?: { selector: string; operator: string; value?: string }[];
}

export interface RateLimitPolicy extends K8sResourceCommon {
  spec: {
    // GEP-2649: targetRefs[] is the current Gateway API form. The singular
    // targetRef is retained for back-compat with policies that have not migrated.
    // Callers SHOULD use policyTargetRefs(p) / policyAttachesTo(p, ...) from
    // utils/policyTargets instead of reading either field directly.
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    defaults?: RateLimitPolicySpec;
    overrides?: RateLimitPolicySpec;
    limits?: Record<string, RateLimit>;
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

export interface TokenRateLimitPolicy extends K8sResourceCommon {
  spec: {
    // GEP-2649: targetRefs[] is the current Gateway API form. The singular
    // targetRef is retained for back-compat with policies that have not migrated.
    // Callers SHOULD use policyTargetRefs(p) / policyAttachesTo(p, ...) from
    // utils/policyTargets instead of reading either field directly.
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    defaults?: {
      limits?: Record<string, { tokens: number; window: string }>;
    };
    overrides?: {
      limits?: Record<string, { tokens: number; window: string }>;
    };
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

export interface DNSPolicy extends K8sResourceCommon {
  spec: {
    // GEP-2649: targetRefs[] is the current Gateway API form. The singular
    // targetRef is retained for back-compat with policies that have not migrated.
    // Callers SHOULD use policyTargetRefs(p) / policyAttachesTo(p, ...) from
    // utils/policyTargets instead of reading either field directly.
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    providerRefs?: { name: string }[];
    loadBalancing?: {
      geo?: { defaultGeo: string };
      weighted?: { defaultWeight: number };
    };
  };
  status?: {
    conditions?: K8sCondition[];
    recordConditions?: Record<string, K8sCondition[]>;
  };
}

/**
 * PlanPolicy (extensions.kuadrant.io/v1alpha1) — declarative plan/tier
 * definition. The Kuadrant extension controller materialises one
 * RateLimitPolicy (and accompanying matcher predicates) per spec.plans[]
 * entry, so this is the authoritative source for "what plans exist on
 * this API and what does each one promise".
 */
export interface PlanTier {
  /** Tier name (gold/silver/bronze/...). Matches `secret.kuadrant.io/plan-id`. */
  tier: string;
  /** CEL predicate the gateway uses to decide if a request belongs to this tier. */
  predicate?: string;
  limits?: {
    /** Per-plan custom rate limits. Empty/missing means "no rate limit". */
    custom?: { limit: number; window: string }[];
  };
}

export interface PlanPolicy extends K8sResourceCommon {
  spec?: {
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    plans?: PlanTier[];
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

export interface TLSPolicy extends K8sResourceCommon {
  spec: {
    // GEP-2649: targetRefs[] is the current Gateway API form. The singular
    // targetRef is retained for back-compat with policies that have not migrated.
    // Callers SHOULD use policyTargetRefs(p) / policyAttachesTo(p, ...) from
    // utils/policyTargets instead of reading either field directly.
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
    issuerRef?: {
      name: string;
      kind?: string;
      group?: string;
    };
    commonName?: string;
    duration?: string;
    renewBefore?: string;
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

/**
 * A policy resource the console did NOT compile-time know about (BackendTLSPolicy
 * on OCP 4.22, any future Kuadrant / Gateway API policy). Discovered at runtime
 * via the GEP-713 CRD label. Carries only the fields every Gateway API policy
 * shares: target references plus standard conditions. Specialized renderers
 * (TLS expiry, DNS propagation, rate-limit RPS, etc.) only apply to the known
 * kinds above; everything else falls back to the generic policy card.
 */
export interface GenericPolicy extends K8sResourceCommon {
  spec?: {
    targetRef?: PolicyTargetReference;
    targetRefs?: PolicyTargetReference[];
  };
  status?: {
    conditions?: K8sCondition[];
  };
}

export type AnyPolicy =
  | AuthPolicy
  | RateLimitPolicy
  | TokenRateLimitPolicy
  | DNSPolicy
  | TLSPolicy;

/** Discriminator allowing UI components to render either the specialized cards or the generic fallback. */
export type AnyPolicyOrGeneric = AnyPolicy | GenericPolicy;

/**
 * Policy kinds for which the console ships a specialized renderer / type.
 * Any new kind added here gets compile-time guarantees (typed spec, dedicated
 * Card UI). Kinds NOT in this union come from GEP-713 discovery and are
 * surfaced through the GenericPolicy fallback renderer.
 */
export type SpecializedPolicyKind =
  | 'AuthPolicy'
  | 'RateLimitPolicy'
  | 'TokenRateLimitPolicy'
  | 'DNSPolicy'
  | 'TLSPolicy';

/** Runtime list mirroring SpecializedPolicyKind for narrowing checks. */
export const SPECIALIZED_POLICY_KINDS: readonly SpecializedPolicyKind[] = [
  'AuthPolicy',
  'RateLimitPolicy',
  'TokenRateLimitPolicy',
  'DNSPolicy',
  'TLSPolicy',
] as const;

/** Type guard usable when narrowing a PolicyKind to the specialized union. */
export function isSpecializedPolicyKind(kind: string): kind is SpecializedPolicyKind {
  return (SPECIALIZED_POLICY_KINDS as readonly string[]).includes(kind);
}

/**
 * Discriminator for `PolicyAttachment.policyKind`. Accepts every specialized
 * kind (preserves IDE autocomplete + type narrowing) AND any other string
 * (so policies discovered at runtime — BackendTLSPolicy on OCP 4.22, future
 * Kuadrant policies — flow through the same attachment shape).
 *
 * The `string & {}` idiom keeps the literal union widened to string at the
 * call site without dropping the autocomplete suggestions for the specialized
 * kinds.
 */
export type PolicyKind = SpecializedPolicyKind | (string & {});

export interface PolicyAttachment {
  /**
   * The attached policy resource. For one of the specialized kinds this is a
   * fully typed AnyPolicy; for any kind discovered at runtime it falls back
   * to GenericPolicy (carries only the Gateway API common shape).
   */
  policy: AnyPolicyOrGeneric;
  policyKind: PolicyKind;
  targetRef: PolicyTargetReference;
  conditions: K8sCondition[];
  isOverridden: boolean;
  isEnforced: boolean;
}
