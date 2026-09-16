import * as React from 'react';
// SDK 4.21 wraps plugin pages in <CompatRouter> which populates the v6
// router context. v5's `useParams` reads the v5 context and returns {}.
// Use the v5-compat shim (which reads v6) for params.
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
} from '@patternfly/react-core';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { RateLimitPolicyGVK } from '../../models';
import { RateLimitPolicy, RateLimit } from '../../types';
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
import { useRateLimitMetrics } from '../../hooks/policies/useRateLimitMetrics';
import RateLimitVisualizer from './RateLimitVisualizer';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import '../../styles/plugin-glass.css';

/**
 * Operational view for a RateLimitPolicy.
 *
 * Replaces the previous `kubectl describe`-style page with the shared
 * policy operational layout (header → summary/status/configuration/
 * metrics on the left, target/affected/troubleshooting/events on the
 * right). The rate-limit-specific bits are the limits visualizer and
 * the per-policy PromQL aggregates (allowed/rejected/top consumers).
 */
const MetricStat: React.FC<{ label: string; value: string; tone?: 'good' | 'bad' | 'warn' | 'neutral' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const color =
    tone === 'good'
      ? 'var(--pf-t--global--color--status--success--default)'
      : tone === 'bad'
      ? 'var(--pf-t--global--color--status--danger--default)'
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

function collectLimits(policy: RateLimitPolicy): Record<string, RateLimit> {
  const spec = policy.spec as unknown as {
    limits?: Record<string, RateLimit>;
    defaults?: { limits?: Record<string, RateLimit> };
    overrides?: { limits?: Record<string, RateLimit> };
  };
  return spec.limits || spec.defaults?.limits || spec.overrides?.limits || {};
}

const RateLimitPolicyDetailPage: React.FC = () => {
  const { ns, name } = useParams<{ ns: string; name: string }>();
  const { t } = useTranslation('plugin__kuadrant-console');

  const [policies, loaded] = useK8sWatchResource<RateLimitPolicy[]>({
    groupVersionKind: RateLimitPolicyGVK,
    isList: true,
  });
  const policy = (policies || []).find(
    (p) => p.metadata?.name === name && p.metadata?.namespace === ns,
  );

  const { metrics, loaded: metricsLoaded, metricsAvailable } = useRateLimitMetrics(policy);

  // `.rhcl-plugin-root` on the loading state keeps the dark surface
  // consistent instead of flashing the Console's raw black chrome.
  if (!loaded) return <div className="rhcl-plugin-root"><Bullseye><Spinner /></Bullseye></div>;
  if (!policy) {
    return (
      <EmptyState headingLevel="h2" titleText={t('RateLimitPolicy not found')}>
        <EmptyStateBody>
          {t('No RateLimitPolicy named {{name}} in namespace {{ns}}.', { name, ns })}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const summary = summarizePolicyStatus(policy);
  const ref = primaryTargetRef(policy);
  const limits = collectLimits(policy);

  return (
    <PolicyLayout
      header={
        <PolicyHeader
          policyName={name || ''}
          policyKind="RateLimitPolicy"
          kindLabel={t('Rate Limit')}
          namespace={ns || ''}
          summary={summary}
          targetRef={ref}
          actions={
            <ResourceActionsMenu
              gvk={{ group: 'kuadrant.io', version: 'v1', kind: 'RateLimitPolicy' }}
              namespace={ns || ''}
              name={name || ''}
              listHref="/connectivity-link/policies"
              resource={policy}
              plural="ratelimitpolicies"
            />
          }
        />
      }
      mainColumn={
        <>
          <PolicySummaryCard
            policy={policy}
            description={t('Rate-limit configuration for the target.')}
            targetRef={ref}
            scope={ref?.kind === 'Gateway' ? t('Per gateway') : t('Per route')}
          />
          <PolicyStatusCard summary={summary} />
          <PolicyConfigurationCard title={t('Rate-limit Plans')}>
            {Object.keys(limits).length === 0 ? (
              <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                {t('No limits declared.')}
              </span>
            ) : (
              <RateLimitVisualizer limits={limits} />
            )}
          </PolicyConfigurationCard>
          <PolicyMetricsCard loaded={metricsLoaded} metricsAvailable={metricsAvailable}>
            <Grid hasGutter>
              <GridItem span={3}>
                <MetricStat label={t('Total / min')} value={metrics.totalPerMin.toString()} />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Allowed')} value={metrics.allowedPerMin.toString()} tone="good" />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Rejected (429)')} value={metrics.rejectedPerMin.toString()} tone="bad" />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Rejection %')} value={`${metrics.rejectionPct}%`} tone="warn" />
              </GridItem>
              <GridItem span={12}>
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Top consumers')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {metrics.topConsumers.length === 0
                        ? '—'
                        : metrics.topConsumers
                            .map((c) => `${c.consumerId} (${c.perMin}/min)`)
                            .join(', ')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </GridItem>
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

export default RateLimitPolicyDetailPage;
