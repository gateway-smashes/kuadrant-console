import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Button,
} from '@patternfly/react-core';
import { ArrowRightIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useK8sWatchResource,
  K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  GatewayGVK,
  HTTPRouteGVK,
  AuthPolicyGVK,
  RateLimitPolicyGVK,
  TokenRateLimitPolicyGVK,
  DNSPolicyGVK,
  TLSPolicyGVK,
} from '../../../models';
import { HTTPRoute } from '../../../types/httproute';
import { PolicyTargetReference } from '../../../types/common';
import { policyAttachesTo } from '../../../utils/policyTargets';

interface Props {
  targetRef?: PolicyTargetReference;
  policyNamespace: string;
}

/**
 * Target Resource card — shows the Gateway/HTTPRoute being protected
 * with operational counts and a click-through. When the target is a
 * Gateway, we count attached HTTPRoutes; when it's an HTTPRoute, we
 * count backendRefs and find the parent Gateway. Both cases tally
 * sibling policies attached to the same target so the operator knows
 * if there's contention.
 */
export const PolicyTargetCard: React.FC<Props> = ({ targetRef, policyNamespace }) => {
  const { t } = useTranslation('plugin__kuadrant-console');

  const targetNs = targetRef?.namespace || policyNamespace;
  const targetKind = targetRef?.kind;
  const targetName = targetRef?.name;

  const [routes] = useK8sWatchResource<HTTPRoute[]>({
    groupVersionKind: HTTPRouteGVK,
    isList: true,
  });
  const [gateways] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: GatewayGVK,
    isList: true,
  });
  const [authP] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: AuthPolicyGVK,
    isList: true,
  });
  const [rlp] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: RateLimitPolicyGVK,
    isList: true,
  });
  const [trlp] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: TokenRateLimitPolicyGVK,
    isList: true,
  });
  const [dnsP] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: DNSPolicyGVK,
    isList: true,
  });
  const [tlsP] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: TLSPolicyGVK,
    isList: true,
  });

  if (!targetRef || !targetKind || !targetName) {
    return (
      <Card>
        <CardTitle>{t('Target Resource')}</CardTitle>
        <CardBody>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
            {t('No target attached')}
          </span>
        </CardBody>
      </Card>
    );
  }

  const allPolicies = [
    ...(authP || []),
    ...(rlp || []),
    ...(trlp || []),
    ...(dnsP || []),
    ...(tlsP || []),
  ];
  const policiesAttached = allPolicies.filter((p) =>
    policyAttachesTo(p, targetKind, targetName, targetNs),
  ).length;

  let routesAffected = 0;
  let backends = 0;
  let parentGateway = '';
  let detailHref = '/connectivity-link/policies';

  if (targetKind === 'Gateway') {
    routesAffected = (routes || []).filter((r) => {
      const refs = r.spec?.parentRefs || [];
      const routeNs = r.metadata?.namespace || '';
      return refs.some((p) => {
        if (p.kind && p.kind !== 'Gateway') return false;
        const ns = p.namespace || routeNs;
        return ns === targetNs && p.name === targetName;
      });
    }).length;
    detailHref = `/connectivity-link/gateways/${targetNs}/${targetName}`;
  } else if (targetKind === 'HTTPRoute') {
    const route = (routes || []).find(
      (r) => r.metadata?.name === targetName && r.metadata?.namespace === targetNs,
    );
    if (route) {
      const refs = (route.spec?.rules || []).flatMap((r) => r.backendRefs || []);
      const distinct = new Set<string>();
      for (const ref of refs) {
        const ns = ref.namespace || route.metadata?.namespace;
        if (ref.name && ns) distinct.add(`${ns}/${ref.name}`);
      }
      backends = distinct.size;
      const parent = (route.spec?.parentRefs || []).find((p) => !p.kind || p.kind === 'Gateway');
      parentGateway = parent?.name || '';
    }
    routesAffected = 1;
    detailHref = `/connectivity-link/httproutes/${targetNs}/${targetName}`;
  }
  // For other target kinds (e.g. Service via BackendTLSPolicy) we drop
  // into a sensible default — the targetRef itself is rendered in the
  // header, so the card just exposes the click-through.
  void gateways;

  return (
    <Card>
      <CardTitle>{t('Target Resource')}</CardTitle>
      <CardBody>
        <DescriptionList isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>{targetKind}</DescriptionListTerm>
            <DescriptionListDescription>
              <strong>{targetName}</strong>
              <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                {targetNs}
              </div>
            </DescriptionListDescription>
          </DescriptionListGroup>
          {targetKind === 'Gateway' && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Routes affected')}</DescriptionListTerm>
              <DescriptionListDescription>{routesAffected}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
          {targetKind === 'HTTPRoute' && (
            <>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Backends')}</DescriptionListTerm>
                <DescriptionListDescription>{backends}</DescriptionListDescription>
              </DescriptionListGroup>
              {parentGateway && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Gateway')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    <Link to={`/connectivity-link/gateways/${targetNs}/${parentGateway}`}>
                      {parentGateway}
                    </Link>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </>
          )}
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Policies attached')}</DescriptionListTerm>
            <DescriptionListDescription>{policiesAttached}</DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
        <div style={{ marginTop: 12 }}>
          <Button
            variant="link"
            component={(props) => <Link {...props} to={detailHref} />}
            isInline
            icon={<ArrowRightIcon />}
            iconPosition="right"
          >
            {targetKind === 'Gateway' ? t('Open Gateway') : t('Open HTTPRoute')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

export default PolicyTargetCard;
