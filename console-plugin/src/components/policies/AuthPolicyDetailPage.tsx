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
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { AuthPolicyGVK } from '../../models';
import { AuthPolicy } from '../../types';
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
import { useAuthPolicyMetrics } from '../../hooks/policies/useAuthPolicyMetrics';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import '../../styles/plugin-glass.css';

// Inspect the spec to figure out which credential mechanisms the policy
// declares — surfaced as a row of badges in the configuration card.
interface AuthRule {
  apiKey?: { selector?: { matchLabels?: Record<string, string> } };
  jwt?: unknown;
  oauth2?: unknown;
  anonymous?: unknown;
  credentials?: { customHeader?: { name?: string }; queryParameter?: { name?: string }; cookie?: { name?: string } };
  when?: Array<{ predicate?: string }>;
}
function collectRules(policy: AuthPolicy): Array<{ name: string; rule: AuthRule }> {
  const spec = policy.spec as unknown as {
    rules?: { authentication?: Record<string, AuthRule> };
    defaults?: { rules?: { authentication?: Record<string, AuthRule> } };
    overrides?: { rules?: { authentication?: Record<string, AuthRule> } };
  };
  const auth =
    spec.rules?.authentication ||
    spec.defaults?.rules?.authentication ||
    spec.overrides?.rules?.authentication ||
    {};
  return Object.entries(auth).map(([name, rule]) => ({ name, rule }));
}

const AuthRulesList: React.FC<{ rules: Array<{ name: string; rule: AuthRule }> }> = ({ rules }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  if (rules.length === 0) {
    return (
      <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
        {t('No authentication rules declared.')}
      </span>
    );
  }
  return (
    <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
      {rules.map(({ name, rule }) => {
        const types: string[] = [];
        if (rule.apiKey) types.push('API Key');
        if (rule.jwt) types.push('JWT');
        if (rule.oauth2) types.push('OAuth2');
        if (rule.anonymous) types.push('Anonymous');
        const source =
          rule.credentials?.customHeader?.name
            ? `header: ${rule.credentials.customHeader.name}`
            : rule.credentials?.queryParameter?.name
            ? `query: ${rule.credentials.queryParameter.name}`
            : rule.credentials?.cookie?.name
            ? `cookie: ${rule.credentials.cookie.name}`
            : null;
        const whenPred = rule.when?.[0]?.predicate;
        return (
          <FlexItem key={name}>
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
                border: '1px solid var(--pf-t--global--border--color--default)',
              }}
            >
              <Flex
                alignItems={{ default: 'alignItemsCenter' }}
                spaceItems={{ default: 'spaceItemsSm' }}
              >
                <FlexItem>
                  <strong>{name}</strong>
                </FlexItem>
                {types.map((tt) => (
                  <FlexItem key={tt}>
                    <Label color="blue" isCompact>
                      {tt}
                    </Label>
                  </FlexItem>
                ))}
              </Flex>
              {source && (
                <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 4 }}>
                  {t('Credential source')}: <code>{source}</code>
                </div>
              )}
              {whenPred && (
                <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 2 }}>
                  {t('Applies when')}: <code>{whenPred}</code>
                </div>
              )}
            </div>
          </FlexItem>
        );
      })}
    </Flex>
  );
};

const AuthPolicyDetailPage: React.FC = () => {
  const { ns, name } = useParams<{ ns: string; name: string }>();
  const { t } = useTranslation('plugin__kuadrant-console');

  const [policies, loaded] = useK8sWatchResource<AuthPolicy[]>({
    groupVersionKind: AuthPolicyGVK,
    isList: true,
  });
  const policy = (policies || []).find(
    (p) => p.metadata?.name === name && p.metadata?.namespace === ns,
  );

  const { metrics, loaded: metricsLoaded, metricsAvailable } = useAuthPolicyMetrics(policy);

  // Wrap the spinner in `.rhcl-plugin-root` so the loading state paints
  // the plugin's `secondary--default` surface instead of Console's black.
  if (!loaded) {
    return <div className="rhcl-plugin-root"><Bullseye><Spinner /></Bullseye></div>;
  }
  if (!policy) {
    return (
      <EmptyState headingLevel="h2" titleText={t('AuthPolicy not found')}>
        <EmptyStateBody>{t('No AuthPolicy named {{name}} in namespace {{ns}}.', { name, ns })}</EmptyStateBody>
      </EmptyState>
    );
  }

  const summary = summarizePolicyStatus(policy);
  const ref = primaryTargetRef(policy);
  const rules = collectRules(policy);

  return (
    <PolicyLayout
      header={
        <PolicyHeader
          policyName={name || ''}
          policyKind="AuthPolicy"
          kindLabel={t('Auth')}
          namespace={ns || ''}
          summary={summary}
          targetRef={ref}
          actions={
            <ResourceActionsMenu
              gvk={{ group: 'kuadrant.io', version: 'v1', kind: 'AuthPolicy' }}
              namespace={ns || ''}
              name={name || ''}
              listHref="/connectivity-link/policies"
              resource={policy}
              plural="authpolicies"
            />
          }
        />
      }
      mainColumn={
        <>
          <PolicySummaryCard
            policy={policy}
            description={t('Authentication and authorization rules for the target.')}
            targetRef={ref}
            scope={ref?.kind === 'Gateway' ? t('Per gateway') : t('Per route')}
          />
          <PolicyStatusCard summary={summary} />
          <PolicyConfigurationCard title={t('Authentication Rules')}>
            <AuthRulesList rules={rules} />
          </PolicyConfigurationCard>
          <PolicyMetricsCard loaded={metricsLoaded} metricsAvailable={metricsAvailable}>
            <Grid hasGutter>
              <GridItem span={3}>
                <MetricStat label={t('Requests / min')} value={metrics.total.toString()} />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Authenticated')} value={metrics.authenticated.toString()} tone="good" />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Unauthorized')} value={metrics.unauthorized.toString()} tone="warn" />
              </GridItem>
              <GridItem span={3}>
                <MetricStat label={t('Forbidden')} value={metrics.forbidden.toString()} tone="bad" />
              </GridItem>
              <GridItem span={12}>
                <DescriptionList isHorizontal isCompact>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Success rate')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <strong>{metrics.successRatePct}%</strong>
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

export default AuthPolicyDetailPage;
