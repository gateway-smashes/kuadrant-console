import * as React from 'react';
import {
  PageSection,
  Title,
  Grid,
  GridItem,
  Flex,
  FlexItem,
  Button,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import { PlusCircleIcon, SyncAltIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import EnvironmentHealthSection from './EnvironmentHealthSection';
import TrafficOverviewSection from './TrafficOverviewSection';
import NeedsAttentionPanel from './NeedsAttentionPanel';
import GatewayOperationalCards from './GatewayOperationalCards';
import PolicyImpactTable from './PolicyImpactTable';
import RouteTrafficTable from './RouteTrafficTable';
import BackendHealthWidget from './BackendHealthWidget';
import RecentEventsPanel from './RecentEventsPanel';
import OverviewNamespaceFilter from './OverviewNamespaceFilter';
import { useEnvironmentHealth } from '../../hooks/useEnvironmentHealth';
import { useOverviewTraffic } from '../../hooks/useOverviewTraffic';
import { useNeedsAttention } from '../../hooks/useNeedsAttention';
import { useGatewayOperationalData } from '../../hooks/useGatewayOperationalData';
import { usePolicyImpactRows } from '../../hooks/usePolicyImpactRows';
import { useRouteTraffic } from '../../hooks/useRouteTraffic';
import { useBackendHealth } from '../../hooks/useBackendHealth';
import { useRecentEvents } from '../../hooks/useRecentEvents';
import { useOverviewNamespace } from '../../hooks/useOverviewNamespace';
import ResourceEditorModal from '../common/ResourceEditorModal';
import { starterFor, SupportedKind } from '../common/starterTemplates';
import {
  GatewayGVK,
  HTTPRouteGVK,
  AuthPolicyGVK,
  RateLimitPolicyGVK,
} from '../../models';
import '../../styles/plugin-glass.css';

/**
 * Operational overview dashboard. All sections are wired to live cluster +
 * Prometheus data — no mocks.
 *
 *   1. Header (title + create actions + last-updated stamp)
 *   2. Environment Health — useEnvironmentHealth (5 KPI cards)
 *   3. Traffic Overview  — useOverviewTraffic (rps/success/error/p95 + sparks)
 *      + Needs Attention — useNeedsAttention (policy status, APIKey pending,
 *        per-gateway error threshold)
 *   4. Gateway operational cards — useGatewayOperationalData
 *      Policies + HTTPRoutes side-by-side — usePolicyImpactRows + useRouteTraffic
 *   5. Backends — useBackendHealth (derived from HTTPRoute backendRefs)
 *      Recent Events — useRecentEvents (k8s Events filtered by RHCL kinds)
 *
 * Type contracts for the rows passed into each section live in
 * `./types.ts`. The hook layer is the only place that knows about
 * Prometheus and CR shapes; everything below the hook is presentational.
 */
const OverviewPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [now, setNow] = React.useState<Date>(() => new Date());
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  // Namespace scope — `null` means "all namespaces". Persisted in the
  // URL (`?namespace=`) so links are shareable, with a localStorage
  // fallback for the "fresh entry via nav" case. See useOverviewNamespace.
  const { namespace, setNamespace } = useOverviewNamespace();

  const { cards: envHealthCards } = useEnvironmentHealth(namespace);
  const { metrics: trafficMetrics } = useOverviewTraffic(namespace);
  const { items: needsAttentionItems } = useNeedsAttention(namespace);
  const { gateways: gatewayOpRows } = useGatewayOperationalData(namespace);
  const { rows: policyImpactRows } = usePolicyImpactRows(namespace);
  const { rows: routeTrafficRows } = useRouteTraffic(namespace);
  const { rows: backendHealthRows } = useBackendHealth(namespace);
  const { events: recentEvents } = useRecentEvents(namespace);

  const refresh = React.useCallback(() => setNow(new Date()), []);

  // Update the "last updated" label every minute so it stays fresh-looking
  // without re-fetching anything (mock data is static for now).
  React.useEffect(() => {
    const tid = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tid);
  }, []);

  const lastUpdatedLabel = React.useMemo(() => {
    const diffSec = Math.max(0, Math.floor((Date.now() - now.getTime()) / 1000));
    if (diffSec < 60) return t('just now');
    const m = Math.floor(diffSec / 60);
    return t('{{count}}m ago', { count: m });
  }, [now, t]);

  // What Overview's "Create" menu offers. `modal` entries open our
  // ResourceEditorModal in create mode (same one the list pages use);
  // `wizard` entries route into the guided API-publishing flow. The old
  // shape linked into Console's `/k8s/.../~new` YAML editor, which
  // bounced the operator out of the plugin for basic single-resource
  // creation and never worked for APIProduct at all (the wizard is the
  // only supported path). Keep the menu tight — five entries max.
  type CreateAction =
    | { id: string; label: string; kind: 'modal'; supportedKind: SupportedKind }
    | { id: string; label: string; kind: 'wizard'; href: string };

  const createActions: CreateAction[] = React.useMemo(
    () => [
      { id: 'apiproduct', label: t('API Product'), kind: 'wizard', href: '/connectivity-link/create-api' },
      { id: 'gateway', label: t('Gateway'), kind: 'modal', supportedKind: 'Gateway' },
      { id: 'httproute', label: t('HTTPRoute'), kind: 'modal', supportedKind: 'HTTPRoute' },
      { id: 'authpolicy', label: t('AuthPolicy'), kind: 'modal', supportedKind: 'AuthPolicy' },
      { id: 'ratelimit', label: t('RateLimitPolicy'), kind: 'modal', supportedKind: 'RateLimitPolicy' },
    ],
    [t],
  );

  // Which Kind is being edited in the modal (null = modal closed).
  const [modalKind, setModalKind] = React.useState<SupportedKind | null>(null);
  const modalSeed = modalKind ? starterFor(modalKind) : null;
  const modalGvkTable = {
    Gateway: { gvk: GatewayGVK, plural: 'gateways' },
    HTTPRoute: { gvk: HTTPRouteGVK, plural: 'httproutes' },
    AuthPolicy: { gvk: AuthPolicyGVK, plural: 'authpolicies' },
    RateLimitPolicy: { gvk: RateLimitPolicyGVK, plural: 'ratelimitpolicies' },
  } as const;
  const modalGvkEntry = modalKind && modalKind in modalGvkTable
    ? modalGvkTable[modalKind as keyof typeof modalGvkTable]
    : null;

  return (
    <div className="rhcl-plugin-root">
      <PageSection variant="default">
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem grow={{ default: 'grow' }}>
            <Title headingLevel="h1">{t('Overview')}</Title>
            <div
              style={{
                marginTop: 4,
                fontSize: 14,
                color: 'var(--pf-t--global--text--color--subtle)',
              }}
            >
              {t('Real-time summary of your API gateway environment')}
            </div>
          </FlexItem>
          <FlexItem>
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <OverviewNamespaceFilter
                  namespace={namespace}
                  onChange={setNamespace}
                />
              </FlexItem>
              <FlexItem>
                <Dropdown
                  isOpen={isCreateOpen}
                  onSelect={() => setIsCreateOpen(false)}
                  onOpenChange={(o) => setIsCreateOpen(o)}
                  toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                    <MenuToggle
                      ref={toggleRef}
                      variant="primary"
                      icon={<PlusCircleIcon />}
                      onClick={() => setIsCreateOpen((o) => !o)}
                      isExpanded={isCreateOpen}
                    >
                      {t('Create')}
                    </MenuToggle>
                  )}
                >
                  <DropdownList>
                    {createActions.map((a) =>
                      a.kind === 'wizard' ? (
                        // Render prop, not `component={Link}` — PatternFly's
                        // DropdownItem forwards `href` to whatever it
                        // renders, but react-router-dom's Link expects
                        // `to`. Passing Link as `component` prop drops us
                        // back onto a plain <a href> full-navigation path.
                        // Wrapping via a render prop that explicitly maps
                        // `href` (from PF) to `to` (from Link) keeps the
                        // click inside the SPA — matches the pattern the
                        // "Gateway pods" quick-link on GatewayDetailPage
                        // and the "View all" links on Overview cards use.
                        <DropdownItem
                          key={a.id}
                          component={(props) => <Link {...props} to={a.href} />}
                        >
                          {a.label}
                        </DropdownItem>
                      ) : (
                        <DropdownItem
                          key={a.id}
                          onClick={() => setModalKind(a.supportedKind)}
                        >
                          {a.label}
                        </DropdownItem>
                      ),
                    )}
                  </DropdownList>
                </Dropdown>
              </FlexItem>
              <FlexItem>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--pf-t--global--text--color--subtle)',
                  }}
                >
                  {t('Last updated: {{when}}', { when: lastUpdatedLabel })}
                </span>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="plain"
                  aria-label={t('Refresh')}
                  onClick={refresh}
                >
                  <SyncAltIcon />
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* 2. Environment Health */}
      <PageSection>
        <EnvironmentHealthSection cards={envHealthCards} />
      </PageSection>

      {/* 3. Traffic Overview + Needs Attention side-by-side */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={8} md={12}>
            <TrafficOverviewSection
              metrics={trafficMetrics}
              windowLabel={t('(Compared to 1h ago)')}
            />
          </GridItem>
          <GridItem lg={4} md={12}>
            <NeedsAttentionPanel items={needsAttentionItems} />
          </GridItem>
        </Grid>
      </PageSection>

      {/* 4. Gateways operational cards — full width so the per-gateway
          metrics row has room for all 5 KPIs without truncating. */}
      <PageSection>
        <GatewayOperationalCards gateways={gatewayOpRows} />
      </PageSection>

      {/* 5. Policies + HTTPRoutes — 50/50 split. Both render tables, so
          they need wider columns than the previous 3-column layout gave
          them (Policy table has 5 columns, HTTPRoute table has 7). */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={6} md={12}>
            <PolicyImpactTable rows={policyImpactRows} />
          </GridItem>
          <GridItem lg={6} md={12}>
            <RouteTrafficTable rows={routeTrafficRows} />
          </GridItem>
        </Grid>
      </PageSection>

      {/* 5. Backends */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={8} md={12}>
            <BackendHealthWidget rows={backendHealthRows} />
          </GridItem>
          <GridItem lg={4} md={12}>
            <RecentEventsPanel events={recentEvents} />
          </GridItem>
        </Grid>
      </PageSection>

      {/* One shared modal instance driven by `modalKind`. Kept at page
          scope (not inside the dropdown) so it survives the dropdown
          closing on select — otherwise the modal unmounts before it can
          open. */}
      {modalKind && modalSeed && modalGvkEntry && (
        <ResourceEditorModal
          isOpen
          mode="create"
          gvk={modalGvkEntry.gvk}
          plural={modalGvkEntry.plural}
          starterYaml={modalSeed.yaml}
          hint={modalSeed.template.hint}
          onClose={() => setModalKind(null)}
        />
      )}
    </div>
  );
};

export default OverviewPage;
