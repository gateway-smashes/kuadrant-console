import * as React from 'react';
import { useParams } from 'react-router-dom-v5-compat';
import {
  Bullseye,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Grid,
  GridItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
} from '@patternfly/react-core';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { DNSPolicyGVK } from '../../models';
import { DNSPolicy } from '../../types';
import { primaryTargetRef } from '../../utils/policyTargets';
import { PolicyLayout } from './shared/PolicyLayout';
import { PolicyHeader } from './shared/PolicyHeader';
import { PolicySummaryCard } from './shared/PolicySummaryCard';
import { PolicyStatusCard } from './shared/PolicyStatusCard';
import { PolicyTargetCard } from './shared/PolicyTargetCard';
import { AffectedResourcesCard } from './shared/AffectedResourcesCard';
import { PolicyTroubleshootingCard } from './shared/PolicyTroubleshootingCard';
import { PolicyEventsCard } from './shared/PolicyEventsCard';
import { PolicyConfigurationCard } from './shared/PolicyConfigurationCard';
import { PolicyMetricsCard } from './shared/PolicyMetricsCard';
import { summarizePolicyStatus } from './shared/state';
import { useDNSPolicyMetrics } from '../../hooks/policies/useDNSPolicyMetrics';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import '../../styles/plugin-glass.css';

const MetricStat: React.FC<{ label: string; value: string; tone?: 'good' | 'warn' | 'neutral' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const color =
    tone === 'good'
      ? 'var(--pf-t--global--color--status--success--default)'
      : tone === 'warn'
      ? 'var(--pf-t--global--color--status--warning--default)'
      : 'var(--pf-t--global--text--color--regular)';
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          color: 'var(--pf-t--global--text--color--subtle)',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
};

const DNSPolicyDetailPage: React.FC = () => {
  const { ns, name } = useParams<{ ns: string; name: string }>();
  const { t } = useTranslation('plugin__kuadrant-console');

  const [policies, loaded] = useK8sWatchResource<DNSPolicy[]>({
    groupVersionKind: DNSPolicyGVK,
    isList: true,
  });
  const policy = (policies || []).find(
    (p) => p.metadata?.name === name && p.metadata?.namespace === ns,
  );
  const { metrics, loaded: metricsLoaded, metricsAvailable } = useDNSPolicyMetrics(policy);

  // `.rhcl-plugin-root` on the loading state keeps the dark surface
  // consistent instead of flashing the Console's raw black chrome.
  if (!loaded) return <div className="rhcl-plugin-root"><Bullseye><Spinner /></Bullseye></div>;
  if (!policy) {
    return (
      <EmptyState headingLevel="h2" titleText={t('DNSPolicy not found')}>
        <EmptyStateBody>
          {t('No DNSPolicy named {{name}} in namespace {{ns}}.', { name, ns })}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const summary = summarizePolicyStatus(policy);
  const ref = primaryTargetRef(policy);
  const spec = policy.spec as unknown as {
    routingStrategy?: string;
    loadBalancing?: { weighted?: unknown; geo?: { defaultGeo?: string } };
    providerRefs?: Array<{ name?: string }>;
    healthCheck?: { endpoint?: string; protocol?: string };
  };

  return (
    <PolicyLayout
      header={
        <PolicyHeader
          policyName={name || ''}
          policyKind="DNSPolicy"
          kindLabel={t('DNS')}
          namespace={ns || ''}
          summary={summary}
          targetRef={ref}
          actions={
            <ResourceActionsMenu
              gvk={{ group: 'kuadrant.io', version: 'v1', kind: 'DNSPolicy' }}
              namespace={ns || ''}
              name={name || ''}
              listHref="/connectivity-link/policies"
              resource={policy}
              plural="dnspolicies"
            />
          }
        />
      }
      mainColumn={
        <>
          <PolicySummaryCard
            policy={policy}
            description={t('DNS record provisioning for the target gateway.')}
            targetRef={ref}
            scope={t('Per gateway')}
          />
          <PolicyStatusCard summary={summary} />
          <PolicyConfigurationCard title={t('DNS Configuration')}>
            <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Routing strategy')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {spec.routingStrategy || t('Simple (default)')}
                </DescriptionListDescription>
              </DescriptionListGroup>
              {spec.loadBalancing?.geo?.defaultGeo && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Default geo')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {spec.loadBalancing.geo.defaultGeo}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {spec.providerRefs && spec.providerRefs.length > 0 && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Providers')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {spec.providerRefs.map((p) => p.name).filter(Boolean).join(', ')}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {spec.healthCheck?.endpoint && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Health check')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {spec.healthCheck.protocol || 'HTTP'} {spec.healthCheck.endpoint}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
          </PolicyConfigurationCard>
          <PolicyMetricsCard
            title={t('DNS Records')}
            loaded={metricsLoaded}
            metricsAvailable={metricsAvailable}
          >
            <Grid hasGutter>
              <GridItem span={4}>
                <MetricStat label={t('Records')} value={metrics.records.toString()} />
              </GridItem>
              <GridItem span={4}>
                <MetricStat
                  label={t('Ready')}
                  value={metrics.ready.toString()}
                  tone={metrics.ready === metrics.records && metrics.records > 0 ? 'good' : 'warn'}
                />
              </GridItem>
              <GridItem span={4}>
                <MetricStat
                  label={t('Failing')}
                  value={(metrics.records - metrics.ready).toString()}
                  tone={metrics.hasFailures ? 'warn' : 'neutral'}
                />
              </GridItem>
              {metrics.rootHostnames.length > 0 && (
                <GridItem span={12}>
                  <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginBottom: 4 }}>
                    {t('Resolved hostnames')}
                  </div>
                  <div>
                    {metrics.rootHostnames.map((h) => (
                      <Label key={h} isCompact style={{ marginRight: 6 }}>
                        {h}
                      </Label>
                    ))}
                  </div>
                </GridItem>
              )}
            </Grid>
          </PolicyMetricsCard>
        </>
      }
      sideColumn={
        <>
          <PolicyTargetCard targetRef={ref} policyNamespace={ns || ''} />
          <AffectedResourcesCard targetRef={ref} policyNamespace={ns || ''} />
          <PolicyTroubleshootingCard policy={policy} summary={summary} targetRef={ref} />
          <PolicyEventsCard policy={policy} />
        </>
      }
    />
  );
};

export default DNSPolicyDetailPage;
