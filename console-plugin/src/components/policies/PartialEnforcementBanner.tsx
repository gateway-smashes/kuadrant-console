import * as React from 'react';
import { Alert, AlertActionLink } from '@patternfly/react-core';
import { Link } from 'react-router-dom';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  AuthPolicyGVK,
  RateLimitPolicyGVK,
  TokenRateLimitPolicyGVK,
  DNSPolicyGVK,
  TLSPolicyGVK,
  policyResourceURL,
} from '../../models';
import {
  AnyPolicy,
  HTTPRoute,
  PolicyKind,
  PolicyTargetReference,
} from '../../types';
import { HTTPRouteGVK } from '../../models';
import { primaryTargetRef } from '../../utils/policyTargets';

interface Props {
  /** Kind of the policy whose status is "partially enforced". */
  policyKind: PolicyKind;
  /** spec.targetRef of the policy. We only compute overshadows when this is a Gateway. */
  targetRef: PolicyTargetReference;
  /** Namespace of the policy (used to build deeplinks for the conflicting policies). */
  policyNamespace: string;
}

const KIND_TO_GVK: Partial<Record<PolicyKind, typeof AuthPolicyGVK>> = {
  AuthPolicy: AuthPolicyGVK,
  RateLimitPolicy: RateLimitPolicyGVK,
  TokenRateLimitPolicy: TokenRateLimitPolicyGVK,
  DNSPolicy: DNSPolicyGVK,
  TLSPolicy: TLSPolicyGVK,
};

/**
 * Banner shown when a policy is reported "partially enforced". Most common
 * cause for Gateway-targeting policies with `spec.defaults` is that some
 * HTTPRoutes attached to the gateway already have their own policy of the
 * same kind — Gateway API GEP-713 says the more-specific route policy wins,
 * so the gateway default only applies to the rest.
 *
 * The banner lists which routes are covered vs. overshadowed, with a deep
 * link to the policy that's winning. This makes the "why" obvious — without
 * it, "partially enforced" is the kind of status that sends an operator
 * digging through YAML at 2am.
 */
export const PartialEnforcementBanner: React.FC<Props> = ({
  policyKind,
  targetRef,
  policyNamespace,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');

  // Only Gateway-targeted policies (with .defaults) can be "partial" via the
  // route-shadows-gateway mechanism. Skip the lookup otherwise; the banner
  // still shows the generic explanation below.
  const isGatewayTarget = targetRef.kind === 'Gateway';
  const gvk = KIND_TO_GVK[policyKind];

  const [routes] = useK8sWatchResource<HTTPRoute[]>(
    isGatewayTarget
      ? { groupVersionKind: HTTPRouteGVK, isList: true, namespaced: false }
      : { isList: true, namespaced: false },
  );
  const [policiesSameKind] = useK8sWatchResource<AnyPolicy[]>(
    isGatewayTarget && gvk
      ? { groupVersionKind: gvk, isList: true, namespaced: false }
      : { isList: true, namespaced: false },
  );

  type RouteCoverage = {
    routeNamespace: string;
    routeName: string;
    covered: boolean;
    overshadowingPolicy?: { namespace: string; name: string };
  };

  const coverage = React.useMemo<RouteCoverage[] | null>(() => {
    if (!isGatewayTarget) return null;
    const allRoutes = (routes || []).filter((r): r is HTTPRoute => !!r);
    const samekind = (policiesSameKind || []).filter((p): p is AnyPolicy => !!p);

    // Routes attached to the policy's target gateway.
    const attached = allRoutes.filter((r) =>
      (r.spec.parentRefs || []).some((pr) => pr.name === targetRef.name),
    );

    // Map (ns/name) → policy of same kind whose targetRef points at it.
    const routeKey = (ns: string, n: string) => `${ns}/${n}`;
    const ownerByRoute = new Map<string, { namespace: string; name: string }>();
    for (const p of samekind) {
      const t = primaryTargetRef(p);
      if (t?.kind !== 'HTTPRoute') continue;
      // policies on the same kind that target an HTTPRoute attached to our gateway
      const targetNs = p.metadata?.namespace || policyNamespace;
      const hit = attached.find(
        (r) => r.metadata?.name === t.name && (r.metadata?.namespace || '') === targetNs,
      );
      if (hit) {
        ownerByRoute.set(
          routeKey(hit.metadata?.namespace || '', hit.metadata?.name || ''),
          { namespace: p.metadata?.namespace || '', name: p.metadata?.name || '' },
        );
      }
    }

    return attached.map((r) => {
      const key = routeKey(r.metadata?.namespace || '', r.metadata?.name || '');
      const owner = ownerByRoute.get(key);
      return {
        routeNamespace: r.metadata?.namespace || '',
        routeName: r.metadata?.name || '',
        covered: !owner,
        overshadowingPolicy: owner,
      };
    });
  }, [routes, policiesSameKind, isGatewayTarget, targetRef.name, policyNamespace]);

  const covered = coverage?.filter((c) => c.covered) ?? [];
  const overshadowed = coverage?.filter((c) => !c.covered) ?? [];

  return (
    <Alert
      variant="info"
      isInline
      title={t('Partially enforced')}
      actionLinks={
        isGatewayTarget && coverage && gvk ? (
          <AlertActionLink
            // AlertActionLink doesn't forward router-link props directly;
            // wrap with onClick to keep PF native styling.
            onClick={() => {
              window.location.hash = `#/k8s/all-namespaces/${gvk.group}~${gvk.version}~${gvk.kind}`;
            }}
          >
            {t('View all {{kind}}s', { kind: policyKind })}
          </AlertActionLink>
        ) : undefined
      }
    >
      {isGatewayTarget ? (
        <>
          <p style={{ marginBottom: 8 }}>
            {t(
              'This policy targets a Gateway with spec.defaults — it only applies to attached HTTPRoutes that do not declare their own {{kind}}. Routes with a more-specific policy override the gateway default (Gateway API GEP-713 defaults semantics).',
              { kind: policyKind },
            )}
          </p>
          {coverage && coverage.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 600 }}>
                {t('Covered by this policy ({{n}})', { n: covered.length })}
              </div>
              {covered.length === 0 ? (
                <div style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</div>
              ) : (
                <ul style={{ margin: '4px 0 8px 18px' }}>
                  {covered.map((c) => (
                    <li key={`${c.routeNamespace}/${c.routeName}`}>
                      <Link
                        to={`/k8s/ns/${c.routeNamespace}/${HTTPRouteGVK.group}~${HTTPRouteGVK.version}~${HTTPRouteGVK.kind}/${c.routeName}`}
                      >
                        {c.routeNamespace}/{c.routeName}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 8, fontWeight: 600 }}>
                {t('Overshadowed by route-level policy ({{n}})', { n: overshadowed.length })}
              </div>
              {overshadowed.length === 0 ? (
                <div style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</div>
              ) : (
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {overshadowed.map((o) => (
                    <li key={`${o.routeNamespace}/${o.routeName}`}>
                      <Link
                        to={`/k8s/ns/${o.routeNamespace}/${HTTPRouteGVK.group}~${HTTPRouteGVK.version}~${HTTPRouteGVK.kind}/${o.routeName}`}
                      >
                        {o.routeNamespace}/{o.routeName}
                      </Link>{' '}
                      {o.overshadowingPolicy && (
                        <>
                          {t('— overridden by')}{' '}
                          <Link
                            to={policyResourceURL(
                              policyKind,
                              o.overshadowingPolicy.namespace,
                              o.overshadowingPolicy.name,
                            )}
                          >
                            {o.overshadowingPolicy.namespace}/
                            {o.overshadowingPolicy.name}
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        <p>
          {t(
            'Some of the resources this policy targets already have a more-specific policy of the same kind, so this one only applies to the remainder.',
          )}
        </p>
      )}
    </Alert>
  );
};

export default PartialEnforcementBanner;
