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
import { TLSPolicyGVK } from '../../models';
import { TLSPolicy } from '../../types';
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
import { useTLSPolicyMetrics, CertificateInfo } from '../../hooks/policies/useTLSPolicyMetrics';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import '../../styles/plugin-glass.css';

const MetricStat: React.FC<{ label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const color =
    tone === 'good'
      ? 'var(--pf-t--global--color--status--success--default)'
      : tone === 'warn'
      ? 'var(--pf-t--global--color--status--warning--default)'
      : tone === 'bad'
      ? 'var(--pf-t--global--color--status--danger--default)'
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

const CertificateRow: React.FC<{ cert: CertificateInfo }> = ({ cert }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const expiryTone: 'good' | 'warn' | 'bad' =
    cert.daysUntilExpiry === null || cert.daysUntilExpiry > 30
      ? 'good'
      : cert.daysUntilExpiry < 7
      ? 'bad'
      : 'warn';
  const expiryColor =
    expiryTone === 'good'
      ? 'var(--pf-t--global--color--status--success--default)'
      : expiryTone === 'warn'
      ? 'var(--pf-t--global--color--status--warning--default)'
      : 'var(--pf-t--global--color--status--danger--default)';
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 6,
        backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
        border: '1px solid var(--pf-t--global--border--color--default)',
      }}
    >
      <div style={{ fontWeight: 600 }}>{cert.name}</div>
      <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Issuer')}</DescriptionListTerm>
          <DescriptionListDescription>{cert.issuer}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Common name')}</DescriptionListTerm>
          <DescriptionListDescription>{cert.commonName || '—'}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('DNS names')}</DescriptionListTerm>
          <DescriptionListDescription>
            {cert.dnsNames.length === 0 ? '—' : cert.dnsNames.join(', ')}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Expires in')}</DescriptionListTerm>
          <DescriptionListDescription>
            <span style={{ color: expiryColor, fontWeight: 600 }}>
              {cert.daysUntilExpiry === null
                ? '—'
                : t('{{n}} days', { n: cert.daysUntilExpiry })}
            </span>
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
          <DescriptionListDescription>
            <Label color={cert.ready ? 'green' : 'orange'} isCompact>
              {cert.ready ? t('Ready') : t('Pending')}
            </Label>
          </DescriptionListDescription>
        </DescriptionListGroup>
      </DescriptionList>
      {cert.message && !cert.ready && (
        <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 4 }}>
          {cert.message}
        </div>
      )}
    </div>
  );
};

const TLSPolicyDetailPage: React.FC = () => {
  const { ns, name } = useParams<{ ns: string; name: string }>();
  const { t } = useTranslation('plugin__kuadrant-console');

  const [policies, loaded] = useK8sWatchResource<TLSPolicy[]>({
    groupVersionKind: TLSPolicyGVK,
    isList: true,
  });
  const policy = (policies || []).find(
    (p) => p.metadata?.name === name && p.metadata?.namespace === ns,
  );
  const { metrics, loaded: metricsLoaded, metricsAvailable } = useTLSPolicyMetrics(policy);

  // `.rhcl-plugin-root` on the loading state keeps the dark surface
  // consistent instead of flashing the Console's raw black chrome.
  if (!loaded) return <div className="rhcl-plugin-root"><Bullseye><Spinner /></Bullseye></div>;
  if (!policy) {
    return (
      <EmptyState headingLevel="h2" titleText={t('TLSPolicy not found')}>
        <EmptyStateBody>
          {t('No TLSPolicy named {{name}} in namespace {{ns}}.', { name, ns })}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const summary = summarizePolicyStatus(policy);
  const ref = primaryTargetRef(policy);
  const spec = policy.spec as unknown as {
    issuerRef?: { name?: string; kind?: string };
    commonName?: string;
    privateKey?: { algorithm?: string; size?: number };
  };

  return (
    <PolicyLayout
      header={
        <PolicyHeader
          policyName={name || ''}
          policyKind="TLSPolicy"
          kindLabel={t('TLS')}
          namespace={ns || ''}
          summary={summary}
          targetRef={ref}
          actions={
            <ResourceActionsMenu
              gvk={{ group: 'kuadrant.io', version: 'v1', kind: 'TLSPolicy' }}
              namespace={ns || ''}
              name={name || ''}
              listHref="/connectivity-link/policies"
              resource={policy}
              plural="tlspolicies"
            />
          }
        />
      }
      mainColumn={
        <>
          <PolicySummaryCard
            policy={policy}
            description={t('TLS configuration for the target gateway.')}
            targetRef={ref}
            scope={t('Per gateway')}
          />
          <PolicyStatusCard summary={summary} />
          <PolicyConfigurationCard title={t('TLS Configuration')}>
            <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
              <DescriptionListGroup>
                <DescriptionListTerm>{t('Issuer')}</DescriptionListTerm>
                <DescriptionListDescription>
                  {spec.issuerRef?.kind || '—'}/{spec.issuerRef?.name || '—'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              {spec.commonName && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Common name')}</DescriptionListTerm>
                  <DescriptionListDescription>{spec.commonName}</DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {spec.privateKey && (
                <DescriptionListGroup>
                  <DescriptionListTerm>{t('Private key')}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {spec.privateKey.algorithm || 'RSA'}{' '}
                    {spec.privateKey.size ? `(${spec.privateKey.size})` : ''}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
          </PolicyConfigurationCard>
          <PolicyMetricsCard
            title={t('Certificates')}
            loaded={metricsLoaded}
            metricsAvailable={metricsAvailable}
          >
            <Grid hasGutter>
              <GridItem span={4}>
                <MetricStat
                  label={t('Certificates')}
                  value={metrics.certificates.length.toString()}
                />
              </GridItem>
              <GridItem span={4}>
                <MetricStat
                  label={t('Expiring soon')}
                  value={metrics.expiringSoon.toString()}
                  tone={metrics.expiringSoon > 0 ? 'warn' : 'good'}
                />
              </GridItem>
              <GridItem span={4}>
                <MetricStat
                  label={t('Not ready')}
                  value={metrics.failed.toString()}
                  tone={metrics.failed > 0 ? 'bad' : 'good'}
                />
              </GridItem>
              <GridItem span={12}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {metrics.certificates.length === 0 ? (
                    <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                      {t('No certificates attributed to this policy.')}
                    </span>
                  ) : (
                    metrics.certificates.map((c) => <CertificateRow key={c.name} cert={c} />)
                  )}
                </div>
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

export default TLSPolicyDetailPage;
