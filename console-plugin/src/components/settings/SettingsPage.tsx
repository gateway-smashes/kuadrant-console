import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  PageSection,
  Title,
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Grid,
  GridItem,
  Label,
  Button,
  Flex,
  FlexItem,
  Icon,
  Alert,
  AlertVariant,
  Spinner,
  Bullseye,
  Tooltip,
  Divider,
  ExpandableSection,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  ExternalLinkAltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  MinusCircleIcon,
  InProgressIcon,
  SyncAltIcon,
  CogIcon,
  MonitoringIcon,
  CatalogIcon,
  GlobeIcon,
  DomainIcon,
  LockIcon,
  DollarSignIcon,
  PlugIcon,
  PencilAltIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import {
  useK8sWatchResource,
  useAccessReview,
  K8sResourceCommon,
  consoleFetch,
} from '@openshift-console/dynamic-plugin-sdk';
import SettingsEditModal from './SettingsEditModal';
import {
  usePluginConfig,
  parseCostPricing,
  CostPricing,
  PluginConfig,
} from '../../utils/pluginConfig';
import { useGrafanaLink } from '../../utils/grafana';
import { useTempoLink } from '../../utils/tempo';
import '../../styles/plugin-glass.css';

/**
 * Settings — an operations dashboard, not a ConfigMap viewer.
 *
 * A cluster / Kuadrant admin lands here to answer, at a glance:
 *   - Is the plugin healthy?
 *   - Which integrations are working / need attention?
 *   - How do I validate them, and where do I troubleshoot?
 *
 * The configuration values themselves are demoted to a collapsed "Advanced"
 * section — the runtime status of each dependency comes first. Modelled on
 * the OpenShift Console "Cluster Operators" pages.
 *
 * Config still comes from the ConfigMap `kuadrant-console-config`
 * (namespace `kuadrant-console`), reconciled by Ansible — so this page is
 * read-only and links out to the native ConfigMap editor.
 */
const CONFIGMAP_NAMESPACE = 'kuadrant-console';
const CONFIGMAP_NAME = 'kuadrant-console-config';
const CONFIGMAP_EDIT_URL = `/k8s/ns/${CONFIGMAP_NAMESPACE}/configmaps/${CONFIGMAP_NAME}/yaml`;
// Keep in sync with package.json — surfaced as a KPI + in Advanced.
const PLUGIN_VERSION = '0.1.0';

type DepState = 'healthy' | 'warning' | 'error' | 'optional' | 'checking';

interface DepRow {
  label: string;
  value: React.ReactNode;
}
interface DepAction {
  label: string;
  icon?: React.ReactNode;
  href?: string; // external (opens in new tab)
  to?: string; // internal SPA route
  onClick?: () => void;
  isDisabled?: boolean;
  isPrimary?: boolean;
}
interface Dependency {
  id: string;
  name: string;
  icon: React.ReactNode;
  state: DepState;
  stateLabel: string;
  tag?: { label: string; color: 'blue' | 'grey' };
  rows: DepRow[];
  /** Optional extra content rendered under the rows (e.g. the Cost pricing table). */
  extra?: React.ReactNode;
  actions: DepAction[];
  warningPanel?: { title: string; body: React.ReactNode };
}

/* ---------------------------------------------------------------- */
/* Probe hooks                                                       */
/* ---------------------------------------------------------------- */

/** Test query against the in-cluster monitoring stack via the Console proxy. */
function usePrometheusProbe(runKey: number): { state: DepState; detail: string; at: number | null } {
  const [state, setState] = React.useState<DepState>('checking');
  const [detail, setDetail] = React.useState('');
  const [at, setAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setState('checking');
    consoleFetch('/api/prometheus/api/v1/query?query=up')
      .then((r) => r.json())
      .then((d: { status?: string; data?: { result?: unknown[] } }) => {
        if (cancelled) return;
        const ok = d?.status === 'success';
        const n = Array.isArray(d?.data?.result) ? d.data.result.length : 0;
        setState(ok ? 'healthy' : 'error');
        setDetail(ok ? `${n} targets up` : 'query failed');
        setAt(Date.now());
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
        setDetail('unreachable');
        setAt(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, [runKey]);
  return { state, detail, at };
}

/** DNS-prober companion health, via the ConsolePlugin proxy alias (same-origin). */
function useDnsProberProbe(url: string | undefined, runKey: number): { state: DepState; at: number | null } {
  const configured = !!url?.trim();
  const [state, setState] = React.useState<DepState>('checking');
  const [at, setAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!configured) {
      setState('optional');
      setAt(null);
      return;
    }
    let cancelled = false;
    setState('checking');
    fetch('/api/proxy/plugin/kuadrant-console/dns-prober/q/health', { credentials: 'include' })
      .then((r) => {
        if (!cancelled) {
          setState(r.ok ? 'healthy' : 'error');
          setAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState('error');
          setAt(Date.now());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configured, runKey]);
  return { state, at };
}

/**
 * Best-effort reachability of an external URL. `no-cors` resolves (opaque) for a
 * reachable origin and rejects on DNS / network / TLS failure — enough to tell
 * "the URL is live" from "the URL is dead", without needing CORS on the target.
 */
function useUrlReachable(url: string | undefined, runKey: number): { state: DepState; at: number | null } {
  const clean = url?.trim();
  const [state, setState] = React.useState<DepState>('checking');
  const [at, setAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!clean) {
      setState('optional');
      setAt(null);
      return;
    }
    let cancelled = false;
    setState('checking');
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    fetch(clean, { mode: 'no-cors', signal: ctrl.signal })
      .then(() => {
        if (!cancelled) {
          setState('healthy');
          setAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState('error');
          setAt(Date.now());
        }
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [clean, runKey]);
  return { state, at };
}

/** Re-renders every 15s so relative timestamps stay fresh. */
function useTick(): void {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 15000);
    return () => window.clearInterval(id);
  }, []);
}

function relTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/* ---------------------------------------------------------------- */
/* Page                                                              */
/* ---------------------------------------------------------------- */

const SettingsPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const { config, loaded } = usePluginConfig();
  useTick();

  const [cm, cmLoaded, cmError] = useK8sWatchResource<K8sResourceCommon>({
    groupVersionKind: { version: 'v1', kind: 'ConfigMap' },
    namespace: CONFIGMAP_NAMESPACE,
    name: CONFIGMAP_NAME,
    isList: false,
  });
  const cmExists = cmLoaded && !cmError && !!cm?.metadata?.name;

  // Editing writes to the ConfigMap, so gate the affordance on the real
  // permission instead of letting the user fill in a form that 403s on save.
  const [canEditConfig] = useAccessReview({
    group: '',
    resource: 'configmaps',
    verb: 'patch',
    namespace: CONFIGMAP_NAMESPACE,
    name: CONFIGMAP_NAME,
  });
  const [editOpen, setEditOpen] = React.useState(false);

  const [runKey, setRunKey] = React.useState(() => Date.now());
  const [validatedAt, setValidatedAt] = React.useState(() => Date.now());
  const runValidation = React.useCallback(() => {
    const now = Date.now();
    setRunKey(now);
    setValidatedAt(now);
  }, []);

  // Probes
  const prom = usePrometheusProbe(runKey);
  const grafana = useGrafanaLink('api-overview', {});
  const tempoNs = config.tempoNamespace || 'tempo';
  const tempoRouteName = config.tempoGatewayRouteName || 'tempo-tempo-rhcl-gateway';
  // Availability comes from the TempoStack CR (same resolver the Gateway /
  // HTTPRoute "View traces" links use), NOT a Route lookup — a Route check
  // was returning false even when Tempo is installed.
  const tempo = useTempoLink({});
  const dnsProber = useDnsProberProbe(config.dnsProberUrl, runKey);
  const devHub = useUrlReachable(config.internalDeveloperHubUrl, runKey);
  const devPortal = useUrlReachable(config.developerPortalUrl, runKey);
  const pricing: CostPricing = React.useMemo(() => parseCostPricing(config.costPricing), [config.costPricing]);
  const pricingTiers = Object.keys(pricing).length;
  const currency = config.costCurrency || 'BRL';

  const grafanaState: DepState = grafana.loading ? 'checking' : grafana.available ? 'healthy' : 'warning';
  const tempoState: DepState = tempo.loading ? 'checking' : tempo.available ? 'healthy' : 'optional';
  const costState: DepState = pricingTiers > 0 ? 'healthy' : 'optional';

  const deps: Dependency[] = [
    {
      id: 'prometheus',
      name: t('Prometheus'),
      icon: <MonitoringIcon />,
      state: prom.state,
      stateLabel: stateLabel(t, prom.state),
      tag: { label: t('Built-in'), color: 'blue' },
      rows: [
        { label: t('Connection'), value: <code>/api/prometheus</code> },
        { label: t('Authentication'), value: t('OpenShift Console session') },
        { label: t('Last query'), value: prom.at ? `${relTime(prom.at)}${prom.detail ? ` · ${prom.detail}` : ''}` : t('Checking…') },
      ],
      actions: [
        { label: t('Test query'), icon: <SyncAltIcon />, onClick: runValidation },
        { label: t('Open Monitoring'), icon: <ExternalLinkAltIcon />, to: '/monitoring' },
      ],
    },
    {
      id: 'grafana',
      name: t('Grafana'),
      icon: <MonitoringIcon />,
      state: grafanaState,
      stateLabel: grafanaState === 'healthy' ? t('Reachable') : t('Route not found'),
      rows: [
        { label: t('Route'), value: codeOrDefault(config.grafanaRouteName, 'rhcl-grafana-route') },
        { label: t('Dashboard prefix'), value: codeOrDefault(config.grafanaDashboardPrefix, 'rhcl-') },
        { label: t('Last validation'), value: relTime(validatedAt) },
      ],
      actions: [
        {
          label: t('Open Grafana'),
          icon: <ExternalLinkAltIcon />,
          href: grafana.url || undefined,
          isDisabled: !grafana.available,
          isPrimary: true,
        },
        { label: t('Validate'), icon: <SyncAltIcon />, onClick: runValidation },
      ],
    },
    {
      id: 'tempo',
      name: t('Tempo (Traces)'),
      icon: <PlugIcon />,
      state: tempoState,
      stateLabel: tempoState === 'healthy' ? t('Reachable') : tempoState === 'checking' ? t('Checking…') : t('Not configured'),
      tag: { label: t('Optional'), color: 'grey' },
      rows: [
        { label: t('Namespace'), value: <code>{tempoNs}</code> },
        { label: t('Gateway route'), value: <code>{tempoRouteName}</code> },
        { label: t('Stack name'), value: codeOrDefault(config.tempoStackName, 'tempo-rhcl') },
      ],
      warningPanel:
        tempoState === 'optional'
          ? {
              title: t('Distributed traces are unavailable'),
              body: t(
                'No TempoStack was found in the configured namespace, so "View traces" deep links on Gateway and HTTPRoute pages stay disabled. Install a TempoStack to enable end-to-end tracing.',
              ),
            }
          : undefined,
      actions:
        tempoState === 'healthy'
          ? [
              { label: t('View traces'), icon: <PlugIcon />, to: tempo.url || undefined, isPrimary: true },
              { label: t('Validate'), icon: <SyncAltIcon />, onClick: runValidation },
            ]
          : [
              {
                label: t('Set up Tempo'),
                icon: <ExternalLinkAltIcon />,
                to: '/operatorhub/ns/openshift-operators?keyword=tempo',
                isPrimary: true,
              },
            ],
    },
    {
      id: 'dns-prober',
      name: t('DNS Prober'),
      icon: <DomainIcon />,
      state: dnsProber.state,
      stateLabel: stateLabel(t, dnsProber.state),
      tag: { label: t('Optional'), color: 'grey' },
      rows: [
        { label: t('Endpoint'), value: <code>/api/proxy/plugin/kuadrant-console/dns-prober</code> },
        { label: t('External URL'), value: codeOrDash(config.dnsProberUrl) },
        { label: t('Last probe'), value: relTime(dnsProber.at) },
      ],
      actions: [
        { label: t('Run DNS test'), icon: <DomainIcon />, to: '/connectivity-link/dns/troubleshooting', isPrimary: true },
      ],
    },
    {
      id: 'developer-hub',
      name: t('Developer Hub'),
      icon: <CatalogIcon />,
      state: devHub.state,
      stateLabel: stateLabel(t, devHub.state),
      rows: [
        { label: t('Public URL'), value: codeOrDash(config.internalDeveloperHubUrl) },
        { label: t('Authentication'), value: t('OIDC') },
        { label: t('Last check'), value: relTime(devHub.at) },
      ],
      actions: [
        {
          label: t('Open'),
          icon: <ExternalLinkAltIcon />,
          href: config.internalDeveloperHubUrl?.trim() || undefined,
          isDisabled: !config.internalDeveloperHubUrl?.trim(),
          isPrimary: true,
        },
        { label: t('Validate'), icon: <SyncAltIcon />, onClick: runValidation },
      ],
    },
    {
      id: 'developer-portal',
      name: t('Developer Portal'),
      icon: <GlobeIcon />,
      state: devPortal.state,
      stateLabel: stateLabel(t, devPortal.state),
      rows: [
        { label: t('Public URL'), value: codeOrDash(config.developerPortalUrl) },
        { label: t('Authentication'), value: t('OIDC') },
        { label: t('Last check'), value: relTime(devPortal.at) },
      ],
      actions: [
        {
          label: t('Open'),
          icon: <ExternalLinkAltIcon />,
          href: config.developerPortalUrl?.trim() || undefined,
          isDisabled: !config.developerPortalUrl?.trim(),
          isPrimary: true,
        },
        { label: t('Validate'), icon: <SyncAltIcon />, onClick: runValidation },
      ],
    },
    {
      id: 'cost',
      name: t('Cost Configuration'),
      icon: <DollarSignIcon />,
      state: costState,
      stateLabel: costState === 'healthy' ? t('{{n}} tier(s)', { n: pricingTiers }) : t('Not configured'),
      tag: { label: t('Optional'), color: 'grey' },
      rows: [
        { label: t('Currency'), value: <code>{currency}</code> },
        { label: t('Monthly budget'), value: config.costBudget ? `${currency} ${Number(config.costBudget).toLocaleString('pt-BR')}` : t('Not set') },
      ],
      extra:
        pricingTiers > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="rhcl-kpi-label" style={{ marginBottom: 6 }}>{t('Pricing tiers (from ConfigMap)')}</div>
            <Table variant="compact" aria-label={t('Cost pricing tiers')}>
              <Thead>
                <Tr>
                  <Th>{t('Tier')}</Th>
                  <Th>{t('Per 1K tokens')}</Th>
                  <Th>{t('Per 1K calls')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {Object.entries(pricing)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([tier, v]) => (
                    <Tr key={tier}>
                      <Td><Label color={tierColor(tier)} isCompact>{tier}</Label></Td>
                      <Td>{currency} {v.tokens_per_1k.toFixed(2)}</Td>
                      <Td>{currency} {v.calls_per_1k.toFixed(2)}</Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
            <div style={{ fontSize: 11, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 6 }}>
              {t('cost = (calls ÷ 1000) × per-1K-calls + (tokens ÷ 1000) × per-1K-tokens, per tier')}
            </div>
          </div>
        ) : undefined,
      actions: [
        { label: t('View pricing configuration'), icon: <DollarSignIcon />, to: '/connectivity-link/cost', isPrimary: true },
      ],
    },
  ];

  // Aggregate health
  const healthy = deps.filter((d) => d.state === 'healthy').length;
  const attention = deps.filter((d) => d.state === 'warning' || d.state === 'optional').length;
  const errors = deps.filter((d) => d.state === 'error').length;
  const overall: DepState = errors > 0 ? 'error' : attention > 0 ? 'warning' : deps.some((d) => d.state === 'checking') ? 'checking' : 'healthy';

  // Validation checks (Section 3)
  const checks: { state: DepState; label: string; at: number | null; action?: DepAction }[] = [
    { state: prom.state, label: t('Prometheus reachable'), at: prom.at, action: { label: t('Retry'), onClick: runValidation } },
    { state: grafanaState, label: t('Grafana route exists'), at: validatedAt },
    { state: 'healthy', label: t('Dashboard prefix configured'), at: validatedAt },
    { state: dnsProber.state, label: t('DNS Prober reachable'), at: dnsProber.at, action: { label: t('Test'), to: '/connectivity-link/dns/troubleshooting' } },
    { state: devHub.state, label: t('Developer Hub URL reachable'), at: devHub.at },
    { state: devPortal.state, label: t('Developer Portal URL reachable'), at: devPortal.at },
    { state: tempoState, label: t('Tempo configured (optional)'), at: validatedAt },
    { state: costState, label: t('Pricing configured'), at: validatedAt },
  ];

  // Quick actions (Section 4)
  const quickActions: {
    id: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    href?: string;
    to?: string;
    disabled?: boolean;
  }[] = [
    { id: 'grafana', icon: <MonitoringIcon />, title: t('Open Grafana'), description: t('API traffic, latency and error-rate dashboards.'), href: grafana.url || undefined, disabled: !grafana.available },
    { id: 'devhub', icon: <CatalogIcon />, title: t('Open Developer Hub'), description: t('Self-service software catalog (RHDH / Backstage).'), href: config.internalDeveloperHubUrl?.trim() || undefined, disabled: !config.internalDeveloperHubUrl?.trim() },
    { id: 'devportal', icon: <GlobeIcon />, title: t('Open Developer Portal'), description: t('External API-consumer portal.'), href: config.developerPortalUrl?.trim() || undefined, disabled: !config.developerPortalUrl?.trim() },
    { id: 'dns', icon: <DomainIcon />, title: t('DNS Troubleshooting'), description: t('Cross-resolver checks and DNSPolicy status.'), to: '/connectivity-link/dns/troubleshooting' },
    { id: 'tls', icon: <LockIcon />, title: t('TLS Troubleshooting'), description: t('Certificate chain and HTTPS handshake probes.'), to: '/connectivity-link/tls/troubleshooting' },
    { id: 'cost', icon: <DollarSignIcon />, title: t('Cost Dashboard'), description: t('Per-consumer usage and monetary breakdown.'), to: '/connectivity-link/cost' },
  ];

  if (!loaded) {
    return (
      <div className="rhcl-plugin-root">
        <PageSection isFilled>
          <Bullseye><Spinner size="xl" /></Bullseye>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="rhcl-plugin-root">
      {/* Header */}
      <PageSection variant="default">
        <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }} flexWrap={{ default: 'wrap' }}>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
              <FlexItem><Icon size="lg"><CogIcon /></Icon></FlexItem>
              <FlexItem>
                <Title headingLevel="h1">{t('Plugin Configuration')}</Title>
                <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Runtime status and dependency validation.')}
                </div>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
              <FlexItem>
                <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Last validation: {{when}}', { when: relTime(validatedAt) })}
                </span>
              </FlexItem>
              {!canEditConfig && (
                <FlexItem>
                  <Tooltip content={t('You do not have permission to patch the plugin ConfigMap.')}>
                    <Label color="grey" isCompact icon={<LockIcon />}>{t('Read only')}</Label>
                  </Tooltip>
                </FlexItem>
              )}
              <FlexItem>
                <Button variant="secondary" component="a" href={CONFIGMAP_EDIT_URL} target="_blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />} iconPosition="end">
                  {t('Open ConfigMap')}
                </Button>
              </FlexItem>
              {canEditConfig && (
                <FlexItem>
                  <Button variant="secondary" onClick={() => setEditOpen(true)} icon={<PencilAltIcon />}>
                    {t('Edit configuration')}
                  </Button>
                </FlexItem>
              )}
              <FlexItem>
                <Button variant="primary" onClick={runValidation} icon={<SyncAltIcon />}>
                  {t('Run Validation')}
                </Button>
              </FlexItem>
              <FlexItem>
                <Tooltip content={t('Refresh')}>
                  <Button variant="plain" aria-label={t('Refresh')} onClick={runValidation}><SyncAltIcon /></Button>
                </Tooltip>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Section 1 — Environment Health */}
      <PageSection>
        <Grid hasGutter>
          <GridItem md={2} sm={6} span={6}>
            <KpiCard label={t('Integrations')} value={deps.length} hint={t('{{n}} configured', { n: healthy + attention + errors })} />
          </GridItem>
          <GridItem md={2} sm={6} span={6}>
            <KpiCard label={t('Healthy')} value={healthy} accent="green" />
          </GridItem>
          <GridItem md={2} sm={6} span={6}>
            <KpiCard label={t('Needs Attention')} value={attention} accent={attention > 0 ? 'gold' : undefined} />
          </GridItem>
          <GridItem md={2} sm={6} span={6}>
            <KpiCard label={t('Errors')} value={errors} accent={errors > 0 ? 'red' : undefined} />
          </GridItem>
          <GridItem md={2} sm={6} span={6}>
            <KpiCard label={t('Plugin Version')} value={PLUGIN_VERSION} />
          </GridItem>
          <GridItem md={2} sm={6} span={6}>
            <Card className="rhcl-ops-card" isFullHeight>
              <CardBody>
                <div className="rhcl-kpi-label">{t('Configuration')}</div>
                <div style={{ marginTop: 8 }}><StatusBadge state={overall} label={overallLabel(t, overall)} /></div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Last validated {{when}}', { when: relTime(validatedAt) })}
                </div>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>

      {/* Section 2 — Dependency Status */}
      <PageSection>
        <SectionHeading title={t('Dependency Status')} subtitle={t('Every integration the plugin relies on, and whether it is responding.')} />
        <Grid hasGutter>
          {deps.map((d) => (
            <GridItem key={d.id} lg={4} md={6} span={12}>
              <DependencyCard dep={d} />
            </GridItem>
          ))}
        </Grid>
      </PageSection>

      {/* Section 3 — Operational Validation */}
      <PageSection>
        <SectionHeading title={t('Operational Validation')} subtitle={t('Automatic checks run against the live cluster.')} />
        <Card className="rhcl-ops-card">
          <CardBody style={{ padding: 0 }}>
            {checks.map((c, i) => (
              <React.Fragment key={c.label}>
                {i > 0 && <Divider />}
                <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }} style={{ padding: '12px 20px' }} spaceItems={{ default: 'spaceItemsMd' }}>
                  <FlexItem flex={{ default: 'flex_1' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                      <FlexItem>{stateIcon(c.state)}</FlexItem>
                      <FlexItem>{c.label}</FlexItem>
                    </Flex>
                  </FlexItem>
                  <FlexItem>
                    <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>{relTime(c.at)}</span>
                  </FlexItem>
                  <FlexItem>{c.action ? <ActionButton action={c.action} variant="link" /> : <span style={{ width: 60, display: 'inline-block' }} />}</FlexItem>
                </Flex>
              </React.Fragment>
            ))}
          </CardBody>
        </Card>
      </PageSection>

      {/* Section 4 — Quick Actions */}
      <PageSection>
        <SectionHeading title={t('Quick Actions')} subtitle={t('Jump straight to the tools admins reach for most.')} />
        <Grid hasGutter>
          {quickActions.map((qa) => (
            <GridItem key={qa.id} lg={4} md={6} span={12}>
              <Card className="rhcl-ops-card" isFullHeight>
                <CardBody>
                  <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }} style={{ height: '100%' }}>
                    <FlexItem>
                      <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem><Icon size="lg" style={{ color: 'var(--pf-t--global--color--brand--default)' }}>{qa.icon}</Icon></FlexItem>
                        <FlexItem><strong>{qa.title}</strong></FlexItem>
                      </Flex>
                    </FlexItem>
                    <FlexItem flex={{ default: 'flex_1' }}>
                      <span style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>{qa.description}</span>
                    </FlexItem>
                    <FlexItem>
                      <ActionButton
                        action={{
                          label: qa.to ? t('Open') : t('Open'),
                          icon: qa.to ? undefined : <ExternalLinkAltIcon />,
                          href: qa.href,
                          to: qa.to,
                          isDisabled: qa.disabled,
                        }}
                        variant="secondary"
                      />
                    </FlexItem>
                  </Flex>
                </CardBody>
              </Card>
            </GridItem>
          ))}
        </Grid>
      </PageSection>

      {/* Section 5 — Advanced (collapsed) */}
      <PageSection>
        <ExpandableSection toggleText={t('Advanced — raw configuration')} isIndented>
          <AdvancedSection
            config={config}
            cmExists={cmExists}
            pricing={pricing}
            currency={currency}
            canEdit={canEditConfig}
            onEdit={() => setEditOpen(true)}
          />
        </ExpandableSection>
      </PageSection>

      {/* Rendered at page scope, not inside a menu/section, so closing the
          surrounding UI can't unmount it mid-edit. */}
      <SettingsEditModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        config={config}
        cm={cmExists ? (cm as { data?: Record<string, string> } & K8sResourceCommon) : undefined}
        namespace={CONFIGMAP_NAMESPACE}
        name={CONFIGMAP_NAME}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- */
/* Section components                                                */
/* ---------------------------------------------------------------- */

const DependencyCard: React.FC<{ dep: Dependency }> = ({ dep }) => (
  <Card className="rhcl-ops-card" isFullHeight>
    <CardTitle>
      <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
        <FlexItem>
          <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
            <FlexItem><Icon>{dep.icon}</Icon></FlexItem>
            <FlexItem>{dep.name}</FlexItem>
            {dep.tag && <FlexItem><Label color={dep.tag.color} isCompact>{dep.tag.label}</Label></FlexItem>}
          </Flex>
        </FlexItem>
        <FlexItem><StatusBadge state={dep.state} label={dep.stateLabel} /></FlexItem>
      </Flex>
    </CardTitle>
    <CardBody>
      <DescriptionList isCompact isHorizontal>
        {dep.rows.map((r) => (
          <DescriptionListGroup key={r.label}>
            <DescriptionListTerm>{r.label}</DescriptionListTerm>
            <DescriptionListDescription>{r.value}</DescriptionListDescription>
          </DescriptionListGroup>
        ))}
      </DescriptionList>
      {dep.extra}
      {dep.warningPanel && (
        <Alert variant={AlertVariant.warning} isInline isPlain title={dep.warningPanel.title} style={{ marginTop: 12 }}>
          <span style={{ fontSize: 12 }}>{dep.warningPanel.body}</span>
        </Alert>
      )}
      <Flex spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: 16 }}>
        {dep.actions.map((a) => (
          <FlexItem key={a.label}>
            <ActionButton action={a} variant={a.isPrimary ? 'secondary' : 'link'} />
          </FlexItem>
        ))}
      </Flex>
    </CardBody>
  </Card>
);

const AdvancedSection: React.FC<{
  config: PluginConfig;
  cmExists: boolean;
  pricing: CostPricing;
  currency: string;
  canEdit: boolean;
  onEdit: () => void;
}> = ({ config, cmExists, pricing, currency, canEdit, onEdit }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const entries = Object.entries(config as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const tiers = Object.entries(pricing).sort(([a], [b]) => a.localeCompare(b));
  const flag = (v?: string) => (v?.trim() ? <Label color="green" isCompact>{t('On')}</Label> : <Label color="grey" isCompact>{t('Off')}</Label>);
  return (
    <Grid hasGutter>
      <GridItem md={6} span={12}>
        <Card className="rhcl-ops-card" isFullHeight>
          <CardTitle>{t('ConfigMap')}</CardTitle>
          <CardBody>
            <DescriptionList isCompact isHorizontal>
              <DescriptionListGroup><DescriptionListTerm>{t('Namespace')}</DescriptionListTerm><DescriptionListDescription><code>{CONFIGMAP_NAMESPACE}</code></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('Name')}</DescriptionListTerm><DescriptionListDescription><code>{CONFIGMAP_NAME}</code></DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('Status')}</DescriptionListTerm><DescriptionListDescription>{cmExists ? <Label color="green" isCompact>{t('Present')}</Label> : <Label color="orange" isCompact>{t('Missing — using defaults')}</Label>}</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('Plugin Version')}</DescriptionListTerm><DescriptionListDescription><code>{PLUGIN_VERSION}</code></DescriptionListDescription></DescriptionListGroup>
            </DescriptionList>
            <Flex spaceItems={{ default: 'spaceItemsMd' }} style={{ marginTop: 12 }}>
              {canEdit && (
                <FlexItem>
                  <Button variant="link" isInline onClick={onEdit} icon={<PencilAltIcon />}>
                    {t('Edit these values')}
                  </Button>
                </FlexItem>
              )}
              <FlexItem>
                <Button variant="link" isInline component="a" href={CONFIGMAP_EDIT_URL} target="_blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />} iconPosition="end">
                  {t('Open raw YAML')}
                </Button>
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </GridItem>
      <GridItem md={6} span={12}>
        <Card className="rhcl-ops-card" isFullHeight>
          <CardTitle>{t('Feature Flags')}</CardTitle>
          <CardBody>
            <DescriptionList isCompact isHorizontal>
              <DescriptionListGroup><DescriptionListTerm>{t('Developer Portal')}</DescriptionListTerm><DescriptionListDescription>{flag(config.developerPortalUrl)}</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('Developer Hub')}</DescriptionListTerm><DescriptionListDescription>{flag(config.internalDeveloperHubUrl)}</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('DNS Prober')}</DescriptionListTerm><DescriptionListDescription>{flag(config.dnsProberUrl)}</DescriptionListDescription></DescriptionListGroup>
              <DescriptionListGroup><DescriptionListTerm>{t('Cost pricing')}</DescriptionListTerm><DescriptionListDescription>{tiers.length > 0 ? <Label color="green" isCompact>{t('On')}</Label> : <Label color="grey" isCompact>{t('Off')}</Label>}</DescriptionListDescription></DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>
      </GridItem>
      {tiers.length > 0 && (
        <GridItem span={12}>
          <Card className="rhcl-ops-card">
            <CardTitle>{t('Pricing Tiers')}</CardTitle>
            <CardBody>
              <Table aria-label={t('Cost pricing tiers')} variant="compact">
                <Thead>
                  <Tr><Th>{t('Tier')}</Th><Th>{t('Per 1K tokens')}</Th><Th>{t('Per 1K calls')}</Th></Tr>
                </Thead>
                <Tbody>
                  {tiers.map(([tier, v]) => (
                    <Tr key={tier}>
                      <Td><Label color={tierColor(tier)} isCompact>{tier}</Label></Td>
                      <Td>{currency} {v.tokens_per_1k.toFixed(4)}</Td>
                      <Td>{currency} {v.calls_per_1k.toFixed(4)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </CardBody>
          </Card>
        </GridItem>
      )}
      <GridItem span={12}>
        <Card className="rhcl-ops-card">
          <CardTitle>{t('Raw values')}</CardTitle>
          <CardBody>
            <Table aria-label={t('ConfigMap contents')} variant="compact">
              <Thead><Tr><Th>{t('Key')}</Th><Th>{t('Value')}</Th></Tr></Thead>
              <Tbody>
                {entries.length === 0 ? (
                  <Tr><Td colSpan={2}>{t('No overrides — every field falls back to its built-in default.')}</Td></Tr>
                ) : (
                  entries.map(([k, v]) => (
                    <Tr key={k}>
                      <Td><code>{k}</code></Td>
                      <Td><code style={{ wordBreak: 'break-all' }}>{String(v)}</code></Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </GridItem>
    </Grid>
  );
};

/* ---------------------------------------------------------------- */
/* Atoms                                                             */
/* ---------------------------------------------------------------- */

const KpiCard: React.FC<{ label: string; value: React.ReactNode; hint?: string; accent?: 'green' | 'gold' | 'red' }> = ({
  label,
  value,
  hint,
  accent,
}) => {
  const color =
    accent === 'green'
      ? 'var(--pf-t--global--color--status--success--default)'
      : accent === 'gold'
      ? 'var(--pf-t--global--color--status--warning--default)'
      : accent === 'red'
      ? 'var(--pf-t--global--color--status--danger--default)'
      : undefined;
  return (
    <Card className="rhcl-ops-card" isFullHeight>
      <CardBody>
        <div className="rhcl-kpi-label">{label}</div>
        <div className="rhcl-kpi-value" style={{ color, marginTop: 6 }}>{value}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 4 }}>{hint}</div>}
      </CardBody>
    </Card>
  );
};

const SectionHeading: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div style={{ marginBottom: 12 }}>
    <Title headingLevel="h2" size="lg">{title}</Title>
    {subtitle && <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 2 }}>{subtitle}</div>}
  </div>
);

const StatusBadge: React.FC<{ state: DepState; label: string }> = ({ state, label }) => {
  const color: 'green' | 'orange' | 'red' | 'grey' | 'blue' =
    state === 'healthy' ? 'green' : state === 'warning' ? 'orange' : state === 'error' ? 'red' : state === 'checking' ? 'blue' : 'grey';
  return (
    <Tooltip content={label}>
      <Label color={color} icon={stateIcon(state)}>{label}</Label>
    </Tooltip>
  );
};

function stateIcon(state: DepState): React.ReactNode {
  switch (state) {
    case 'healthy':
      return <Icon status="success"><CheckCircleIcon /></Icon>;
    case 'warning':
      return <Icon status="warning"><ExclamationTriangleIcon /></Icon>;
    case 'error':
      return <Icon status="danger"><ExclamationCircleIcon /></Icon>;
    case 'checking':
      return <Icon><InProgressIcon /></Icon>;
    default:
      return <Icon><MinusCircleIcon /></Icon>;
  }
}

const ActionButton: React.FC<{ action: DepAction; variant: 'primary' | 'secondary' | 'link' }> = ({ action, variant }) => {
  const content = (
    <>
      {action.label}
    </>
  );
  if (action.to && !action.isDisabled) {
    return (
      <Button variant={variant} icon={action.icon} component={(props) => <Link {...props} to={action.to as string} />}>
        {content}
      </Button>
    );
  }
  if (action.href && !action.isDisabled) {
    return (
      <Button variant={variant} icon={action.icon} iconPosition="end" component="a" href={action.href} target="_blank" rel="noopener noreferrer">
        {content}
      </Button>
    );
  }
  return (
    <Button variant={variant} icon={action.icon} onClick={action.onClick} isDisabled={action.isDisabled || (!action.onClick && !action.href && !action.to)}>
      {content}
    </Button>
  );
};

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

function stateLabel(t: (k: string) => string, s: DepState): string {
  switch (s) {
    case 'healthy':
      return t('Healthy');
    case 'warning':
      return t('Needs Attention');
    case 'error':
      return t('Error');
    case 'checking':
      return t('Checking…');
    default:
      return t('Not configured');
  }
}

function overallLabel(t: (k: string) => string, s: DepState): string {
  switch (s) {
    case 'healthy':
      return t('Healthy');
    case 'warning':
      return t('Degraded');
    case 'error':
      return t('Critical');
    case 'checking':
      return t('Validating…');
    default:
      return t('Healthy');
  }
}

const tierColor = (tier: string): 'yellow' | 'grey' | 'orange' | 'blue' | 'red' => {
  const x = tier.toLowerCase();
  if (x === 'gold') return 'yellow';
  if (x === 'silver') return 'grey';
  if (x === 'bronze') return 'orange';
  if (x === 'anonymous') return 'blue';
  return 'red';
};

const codeOrDefault = (v: string | undefined, dflt: string): React.ReactNode =>
  v?.trim() ? <code>{v}</code> : (
    <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}><code>{dflt}</code> ({'default'})</span>
  );

const codeOrDash = (v: string | undefined): React.ReactNode =>
  v?.trim() ? <code style={{ wordBreak: 'break-all' }}>{v}</code> : <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</span>;

export default SettingsPage;
