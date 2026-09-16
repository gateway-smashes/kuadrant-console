import * as React from 'react';
// SDK 4.21 federates react-router 5.3; in v5 `Link` lives only in
// `react-router-dom`. Keep this until we move back to SDK 4.22+.
import { Link } from 'react-router-dom';
import { PageSection, Title, Spinner, Bullseye, Label, Tooltip, Flex, FlexItem } from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  AuthPolicyGVK,
  RateLimitPolicyGVK,
  TokenRateLimitPolicyGVK,
  DNSPolicyGVK,
  TLSPolicyGVK,
  POLICY_KIND_LABELS,
  policyResourceURL,
} from '../../models';
import {
  AuthPolicy,
  RateLimitPolicy,
  TokenRateLimitPolicy,
  DNSPolicy,
  TLSPolicy,
  AnyPolicy,
  PolicyKind,
  PolicyTargetReference,
} from '../../types';
import { getWorstConditionSeverity, isConditionTrue, getEnforcementState } from '../../utils/status';
import { primaryTargetRef } from '../../utils/policyTargets';
import StatusLabel from '../common/StatusLabel';
import FilterToolbar from '../common/FilterToolbar';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import CreateResourceMenu from '../common/CreateResourceMenu';
import { ratesToRpm } from './RateLimitVisualizer';
import { RateLimit, counterText } from '../../types';
import '../../styles/plugin-glass.css';

interface PolicyRow {
  policy: AnyPolicy;
  policyKind: PolicyKind;
  targetRef: PolicyTargetReference;
}

// Local kind→GVK lookup so the per-row Actions menu can hand a concrete GVK
// to ResourceActionsMenu. Mirrors POLICY_KIND_TO_GVK in models/index.ts but
// that map isn't exported; the five kinds we render here match exactly.
const POLICY_ROW_GVK: Record<PolicyKind, { group?: string; version: string; kind: string }> = {
  AuthPolicy: AuthPolicyGVK,
  RateLimitPolicy: RateLimitPolicyGVK,
  TokenRateLimitPolicy: TokenRateLimitPolicyGVK,
  DNSPolicy: DNSPolicyGVK,
  TLSPolicy: TLSPolicyGVK,
};

// Plural REST names used by k8sUpdate when the row's Edit action opens
// ResourceEditorModal. Kept next to the GVK map — one lookup per row.
const POLICY_ROW_PLURAL: Record<PolicyKind, string> = {
  AuthPolicy: 'authpolicies',
  RateLimitPolicy: 'ratelimitpolicies',
  TokenRateLimitPolicy: 'tokenratelimitpolicies',
  DNSPolicy: 'dnspolicies',
  TLSPolicy: 'tlspolicies',
};

const PolicyListPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [searchValue, setSearchValue] = React.useState('');
  const [selectedNamespace, setSelectedNamespace] = React.useState('');
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);

  const [authPolicies, authLoaded] = useK8sWatchResource<AuthPolicy[]>({
    groupVersionKind: AuthPolicyGVK,
    isList: true,
  });
  const [rlPolicies, rlLoaded] = useK8sWatchResource<RateLimitPolicy[]>({
    groupVersionKind: RateLimitPolicyGVK,
    isList: true,
  });
  const [trlPolicies, trlLoaded] = useK8sWatchResource<TokenRateLimitPolicy[]>({
    groupVersionKind: TokenRateLimitPolicyGVK,
    isList: true,
  });
  const [dnsPolicies, dnsLoaded] = useK8sWatchResource<DNSPolicy[]>({
    groupVersionKind: DNSPolicyGVK,
    isList: true,
  });
  const [tlsPolicies, tlsLoaded] = useK8sWatchResource<TLSPolicy[]>({
    groupVersionKind: TLSPolicyGVK,
    isList: true,
  });

  const loaded = authLoaded && rlLoaded && trlLoaded && dnsLoaded && tlsLoaded;

  const allPolicies = React.useMemo((): PolicyRow[] => {
    const rows: PolicyRow[] = [];

    const addRows = (items: AnyPolicy[] | undefined, kind: PolicyKind) => {
      for (const p of items || []) {
        // Handles both spec.targetRefs[] (GEP-2649) and legacy spec.targetRef.
        // Policies without any target ref are skipped (degenerate state).
        const ref = primaryTargetRef(p);
        if (!ref) continue;
        rows.push({ policy: p, policyKind: kind, targetRef: ref });
      }
    };

    addRows(authPolicies, 'AuthPolicy');
    addRows(rlPolicies, 'RateLimitPolicy');
    addRows(trlPolicies, 'TokenRateLimitPolicy');
    addRows(dnsPolicies, 'DNSPolicy');
    addRows(tlsPolicies, 'TLSPolicy');

    return rows;
  }, [authPolicies, rlPolicies, trlPolicies, dnsPolicies, tlsPolicies]);

  const namespaces = React.useMemo(
    () => [...new Set(allPolicies.map((r) => r.policy.metadata?.namespace || ''))].sort(),
    [allPolicies],
  );

  const filtered = React.useMemo(() => {
    let items = allPolicies;

    if (selectedNamespace) {
      items = items.filter((r) => r.policy.metadata?.namespace === selectedNamespace);
    }

    if (selectedTypes.length > 0) {
      items = items.filter((r) => selectedTypes.includes(r.policyKind));
    }

    if (searchValue) {
      const lower = searchValue.toLowerCase();
      items = items.filter((r) => {
        const name = (r.policy.metadata?.name || '').toLowerCase();
        const target = r.targetRef.name.toLowerCase();
        return name.includes(lower) || target.includes(lower);
      });
    }

    if (selectedStatuses.length > 0) {
      items = items.filter((r) => {
        const conditions = r.policy.status?.conditions || [];
        return selectedStatuses.some((s) => {
          if (s === 'Accepted') return isConditionTrue(conditions, 'Accepted');
          if (s === 'Enforced') return isConditionTrue(conditions, 'Enforced');
          if (s === 'Overridden') return isConditionTrue(conditions, 'Overridden');
          if (s === 'Failing') {
            const sev = getWorstConditionSeverity(conditions);
            return sev === 'critical' || sev === 'warning';
          }
          return false;
        });
      });
    }

    return items;
  }, [allPolicies, selectedNamespace, searchValue, selectedStatuses, selectedTypes]);

  // Preserve `.rhcl-plugin-root` while policies load — avoids the black
  // background flash before the list renders.
  if (!loaded) {
    return (
      <div className="rhcl-plugin-root">
        <PageSection variant="default">
          <Title headingLevel="h1">{t('Policies')}</Title>
        </PageSection>
        <PageSection isFilled>
          <Bullseye><Spinner size="xl" /></Bullseye>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="rhcl-plugin-root">
      <PageSection variant="default">
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1">{t('Policies')}</Title>
          </FlexItem>
          <FlexItem>
            <CreateResourceMenu
              kinds={['AuthPolicy', 'RateLimitPolicy', 'TokenRateLimitPolicy', 'DNSPolicy', 'TLSPolicy']}
              defaultNamespace={selectedNamespace}
              buttonLabel={t('Create policy')}
            />
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection>
        <FilterToolbar
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          namespaces={namespaces}
          selectedNamespace={selectedNamespace}
          onNamespaceChange={setSelectedNamespace}
          statusOptions={['Accepted', 'Enforced', 'Overridden', 'Failing']}
          selectedStatuses={selectedStatuses}
          onStatusChange={setSelectedStatuses}
          typeOptions={['AuthPolicy', 'RateLimitPolicy', 'TokenRateLimitPolicy', 'DNSPolicy', 'TLSPolicy']}
          selectedTypes={selectedTypes}
          onTypeChange={setSelectedTypes}
          typeLabel="All policy types"
        />
        <Table aria-label={t('Policies')}>
          <Thead>
            <Tr>
              <Th>{t('Name')}</Th>
              <Th>{t('Namespace')}</Th>
              <Th>{t('Policy type')}</Th>
              <Th>{t('Target')}</Th>
              {/* Scope + Limit only carry meaning for rate-limit rows; the
                  cells render an em-dash for AuthPolicy/TLS/DNS rather than
                  collapsing the columns so the table layout stays steady. */}
              <Th>{t('Scope')}</Th>
              <Th>{t('Limit')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Condition')}</Th>
              <Th aria-label={t('Actions')} />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((row) => {
              const ns = row.policy.metadata?.namespace || '';
              const name = row.policy.metadata?.name || '';
              const conditions = row.policy.status?.conditions || [];
              const overridden = isConditionTrue(conditions, 'Overridden');

              const targetPath =
                row.targetRef.kind === 'Gateway'
                  ? `/connectivity-link/gateways/${row.targetRef.namespace || ns}/${row.targetRef.name}`
                  : `/connectivity-link/httproutes/${row.targetRef.namespace || ns}/${row.targetRef.name}`;

              // Every Kuadrant policy kind now ships its own operational
              // detail page — policyResourceURL routes to the plugin
              // for known kinds and to the native CR YAML page only as a
              // last resort (e.g. a runtime-discovered policy CRD that
              // doesn't have a dedicated renderer yet).
              const nameCell = <Link to={policyResourceURL(row.policyKind, ns, name)}>{name}</Link>;

              const { scope, limit } = describePolicyRow(row);

              return (
                <Tr key={row.policy.metadata?.uid}>
                  <Td>{nameCell}</Td>
                  <Td>{ns}</Td>
                  <Td>
                    <Label color="blue">
                      {POLICY_KIND_LABELS[row.policyKind] || row.policyKind}
                    </Label>
                  </Td>
                  <Td>
                    <Link to={targetPath}>
                      {row.targetRef.kind}/{row.targetRef.name}
                    </Link>
                  </Td>
                  <Td>{scope ?? <DimDash />}</Td>
                  <Td>{limit ?? <DimDash />}</Td>
                  <Td>
                    <StatusLabel conditions={conditions} />
                  </Td>
                  <Td>
                    {overridden ? (
                      <Label color="orange">{t('Overridden')}</Label>
                    ) : (() => {
                      const enf = getEnforcementState(conditions);
                      if (enf === 'fully') {
                        return <Label color="green">{t('Enforced')}</Label>;
                      }
                      if (enf === 'partially') {
                        return (
                          <Tooltip
                            content={
                              row.targetRef.kind === 'Gateway'
                                ? t(
                                    'Applies only to routes attached to {{target}} that do not declare their own policy of this kind. Routes with a more-specific policy override the gateway default (Gateway API GEP-713 defaults semantics).',
                                    { target: row.targetRef.name },
                                  )
                                : t(
                                    'Some of the attached resources already have a more-specific policy that overrides this one.',
                                  )
                            }
                          >
                            <Label color="blue">{t('Partial')}</Label>
                          </Tooltip>
                        );
                      }
                      return <Label color="grey">{t('Accepted')}</Label>;
                    })()}
                  </Td>
                  <Td isActionCell>
                    <ResourceActionsMenu
                      gvk={POLICY_ROW_GVK[row.policyKind]}
                      namespace={ns}
                      name={name}
                      listHref="/connectivity-link/policies"
                      resource={row.policy}
                      plural={POLICY_ROW_PLURAL[row.policyKind]}
                    />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </PageSection>
    </div>
  );
};

/**
 * Returns the Scope + Limit cells for a row.
 *
 *   - RateLimitPolicy / TokenRateLimitPolicy: derived from spec.
 *   - Everything else: scope/limit are `null` (cells render as dashes).
 *
 * Scope picks "Per API Key" when any limit declares counters that look like
 * an auth identity selector; otherwise falls back to "Per route"/"Per gateway"
 * based on the target kind. Limit shows the tightest req/min across all
 * named limits, or "Unlimited" when no concrete rate is declared.
 */
function describePolicyRow(row: PolicyRow): { scope: string | null; limit: string | null } {
  if (row.policyKind !== 'RateLimitPolicy' && row.policyKind !== 'TokenRateLimitPolicy') {
    return { scope: null, limit: null };
  }
  const spec = (row.policy as { spec?: { limits?: Record<string, RateLimit>; defaults?: { limits?: Record<string, RateLimit> }; overrides?: { limits?: Record<string, RateLimit> } } }).spec;
  const merged: Record<string, RateLimit> = {
    ...(spec?.limits || {}),
    ...(spec?.defaults?.limits || {}),
    ...(spec?.overrides?.limits || {}),
  };
  const allLimits = Object.values(merged);
  const counters = allLimits.flatMap((l) => l.counters || []).map(counterText).filter(Boolean);

  let scope = 'Per route';
  if (row.targetRef.kind === 'Gateway') scope = 'Per gateway';
  if (counters.length > 0) {
    const apiKeyMatch = counters.some((c) => /(api[_-]?key|identity|consumer|metadata\.name)/i.test(c));
    scope = apiKeyMatch ? 'Per API Key' : `Custom (${counters[0]})`;
  }

  const rates = allLimits.map((l) => ratesToRpm(l.rates)).filter((r): r is number => r !== undefined);
  let limit: string;
  if (rates.length === 0) {
    limit = '∞ Unlimited';
  } else {
    const tightest = Math.min(...rates);
    limit = `${tightest.toLocaleString(undefined, { maximumFractionDigits: 0 })} req/min`;
  }

  return { scope, limit };
}

function DimDash() {
  return <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</span>;
}

export default PolicyListPage;
