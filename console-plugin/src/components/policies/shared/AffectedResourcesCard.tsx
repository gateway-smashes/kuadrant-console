import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useK8sWatchResource,
  K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import { HTTPRouteGVK, APIProductGVK } from '../../../models';
import { HTTPRoute } from '../../../types/httproute';
import { PolicyTargetReference } from '../../../types/common';

interface Props {
  targetRef?: PolicyTargetReference;
  policyNamespace: string;
}

const Counter: React.FC<{
  label: string;
  value: number;
  href?: string;
}> = ({ label, value, href }) => {
  const body = (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--pf-t--global--text--color--regular)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--pf-t--global--text--color--subtle)' }}>
        {label}
      </div>
    </div>
  );
  return href ? <Link to={href}>{body}</Link> : body;
};

/**
 * Cluster impact widget — at-a-glance "how many things does this
 * policy ultimately touch?". Computed from the target's downstream
 * graph (Gateway → Routes → Backends, or HTTPRoute → Backends), with
 * API Products counted separately since they're a flat list.
 */
export const AffectedResourcesCard: React.FC<Props> = ({ targetRef, policyNamespace }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [routes] = useK8sWatchResource<HTTPRoute[]>({
    groupVersionKind: HTTPRouteGVK,
    isList: true,
  });
  const [apiProducts] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: APIProductGVK,
    isList: true,
  });

  const targetNs = targetRef?.namespace || policyNamespace;
  let gateways = 0;
  let routesCount = 0;
  let backends = 0;
  let apProducts = 0;

  if (targetRef?.kind === 'Gateway' && targetRef.name) {
    gateways = 1;
    const attached = (routes || []).filter((r) => {
      const refs = r.spec?.parentRefs || [];
      const routeNs = r.metadata?.namespace || '';
      return refs.some(
        (p) =>
          (!p.kind || p.kind === 'Gateway') &&
          (p.namespace || routeNs) === targetNs &&
          p.name === targetRef.name,
      );
    });
    routesCount = attached.length;
    const distinct = new Set<string>();
    for (const r of attached) {
      const rNs = r.metadata?.namespace || '';
      for (const rule of r.spec?.rules || []) {
        for (const ref of rule.backendRefs || []) {
          const ns = ref.namespace || rNs;
          if (ref.name && ns) distinct.add(`${ns}/${ref.name}`);
        }
      }
    }
    backends = distinct.size;
  } else if (targetRef?.kind === 'HTTPRoute' && targetRef.name) {
    routesCount = 1;
    const route = (routes || []).find(
      (r) => r.metadata?.name === targetRef.name && r.metadata?.namespace === targetNs,
    );
    if (route) {
      const distinct = new Set<string>();
      for (const rule of route.spec?.rules || []) {
        for (const ref of rule.backendRefs || []) {
          const ns = ref.namespace || route.metadata?.namespace;
          if (ref.name && ns) distinct.add(`${ns}/${ref.name}`);
        }
      }
      backends = distinct.size;
      const parent = (route.spec?.parentRefs || []).find((p) => !p.kind || p.kind === 'Gateway');
      if (parent) gateways = 1;
    }
  }

  // Best-effort: count APIProducts whose spec references this same target.
  // We don't have a strict link from policy → APIProduct, so we approximate
  // by matching APIProducts whose metadata.namespace matches the target's.
  apProducts = (apiProducts || []).filter(
    (a) => a.metadata?.namespace === targetNs,
  ).length;

  return (
    <Card>
      <CardTitle>{t('Affected Resources')}</CardTitle>
      <CardBody>
        <Grid hasGutter>
          <GridItem span={3}>
            <Counter
              label={t('Gateways')}
              value={gateways}
              href={
                targetRef?.kind === 'Gateway'
                  ? `/connectivity-link/gateways/${targetNs}/${targetRef.name}`
                  : undefined
              }
            />
          </GridItem>
          <GridItem span={3}>
            <Counter
              label={t('Routes')}
              value={routesCount}
              href={
                targetRef?.kind === 'HTTPRoute'
                  ? `/connectivity-link/httproutes/${targetNs}/${targetRef.name}`
                  : '/connectivity-link/httproutes'
              }
            />
          </GridItem>
          <GridItem span={3}>
            <Counter label={t('Backends')} value={backends} />
          </GridItem>
          <GridItem span={3}>
            <Counter
              label={t('API Products')}
              value={apProducts}
              href="/connectivity-link/api-products"
            />
          </GridItem>
        </Grid>
      </CardBody>
    </Card>
  );
};

export default AffectedResourcesCard;
