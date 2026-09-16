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
} from '@patternfly/react-core';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { TokenRateLimitPolicyGVK } from '../../models';
import { TokenRateLimitPolicy, counterText } from '../../types';
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
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import '../../styles/plugin-glass.css';

interface TokenBucketRow {
  name: string;
  size?: number;
  refill?: { rate?: number; period?: string };
  scope?: string;
  when?: string;
}

function collectBuckets(policy: TokenRateLimitPolicy): TokenBucketRow[] {
  const spec = policy.spec as unknown as {
    limits?: Record<string, { rates?: { limit: number; window: string }[]; counters?: Array<string | { expression?: string }>; when?: Array<{ predicate?: string }> }>;
  };
  const limits = spec.limits || {};
  return Object.entries(limits).map(([name, val]) => {
    const rate = val.rates?.[0];
    return {
      name,
      size: rate?.limit,
      refill: rate ? { rate: rate.limit, period: rate.window } : undefined,
      scope: counterText(val.counters?.[0]) || 'global',
      when: val.when?.[0]?.predicate,
    };
  });
}

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

const TokenRateLimitPolicyDetailPage: React.FC = () => {
  const { ns, name } = useParams<{ ns: string; name: string }>();
  const { t } = useTranslation('plugin__kuadrant-console');

  const [policies, loaded] = useK8sWatchResource<TokenRateLimitPolicy[]>({
    groupVersionKind: TokenRateLimitPolicyGVK,
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
      <EmptyState headingLevel="h2" titleText={t('TokenRateLimitPolicy not found')}>
        <EmptyStateBody>{t('No TokenRateLimitPolicy named {{name}} in namespace {{ns}}.', { name, ns })}</EmptyStateBody>
      </EmptyState>
    );
  }

  const summary = summarizePolicyStatus(policy);
  const ref = primaryTargetRef(policy);
  const buckets = collectBuckets(policy);

  return (
    <PolicyLayout
      header={
        <PolicyHeader
          policyName={name || ''}
          policyKind="TokenRateLimitPolicy"
          kindLabel={t('Token Rate Limit')}
          namespace={ns || ''}
          summary={summary}
          targetRef={ref}
          actions={
            <ResourceActionsMenu
              gvk={{ group: 'kuadrant.io', version: 'v1alpha1', kind: 'TokenRateLimitPolicy' }}
              namespace={ns || ''}
              name={name || ''}
              listHref="/connectivity-link/policies"
              resource={policy}
              plural="tokenratelimitpolicies"
            />
          }
        />
      }
      mainColumn={
        <>
          <PolicySummaryCard
            policy={policy}
            description={t('Token-bucket rate limit shared across consumers.')}
            targetRef={ref}
            scope={ref?.kind === 'Gateway' ? t('Per gateway') : t('Per route')}
          />
          <PolicyStatusCard summary={summary} />
          <PolicyConfigurationCard title={t('Token Buckets')}>
            {buckets.length === 0 ? (
              <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                {t('No buckets declared.')}
              </span>
            ) : (
              <Grid hasGutter>
                {buckets.map((b) => (
                  <GridItem key={b.name} span={12}>
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 6,
                        backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
                        border: '1px solid var(--pf-t--global--border--color--default)',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>{b.name}</div>
                      <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Bucket size')}</DescriptionListTerm>
                          <DescriptionListDescription>{b.size ?? '—'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Refill rate')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {b.refill?.rate ?? '—'} / {b.refill?.period ?? '—'}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Scope')}</DescriptionListTerm>
                          <DescriptionListDescription>{b.scope || 'global'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        {b.when && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Applies when')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              <code>{b.when}</code>
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                      </DescriptionList>
                    </div>
                  </GridItem>
                ))}
              </Grid>
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

export default TokenRateLimitPolicyDetailPage;
