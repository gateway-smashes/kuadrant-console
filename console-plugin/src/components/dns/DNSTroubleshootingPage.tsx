import * as React from 'react';
import {
  PageSection,
  Title,
  Button,
  Grid,
  GridItem,
  Spinner,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
} from '@patternfly/react-core';
import {
  SyncAltIcon,
  PlusCircleIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  MinusCircleIcon,
  ExclamationTriangleIcon,
  GlobeIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { useDnsTroubleshooting } from './useDnsTroubleshooting';
import DNSFlowDiagram from './DNSFlowDiagram';
import DNSDiagnosisPanel from './DNSDiagnosisPanel';
import DNSTimeline from './DNSTimeline';
import DNSDiagnosticsTable from './DNSDiagnosticsTable';
import DNSResolverTable from './DNSResolverTable';
import DNSAdvancedSection from './DNSAdvancedSection';
import ResourceEditorModal from '../common/ResourceEditorModal';
import { useDnsProber } from './useDnsProber';
import { starterFor } from '../common/starterTemplates';
import { DNSPolicyGVK } from '../../models';
import { STATUS_META } from './types';
import '../../styles/plugin-glass.css';
import './dns-troubleshooting.css';

/**
 * Top-level page. The layout follows the mock:
 *
 *   1. Header — title, hostname picker, refresh, run-checks
 *   2. Overall status banner + legend
 *   3. Flow diagram (7 cards + connectors)
 *   4. Three-column mid section: Timeline | DNS checks | Diagnosis
 *   5. Bottom-wide: DNS resolvers table
 *
 * Everything reads from `useDnsTroubleshooting`, one big memoised
 * derivation of cluster + Prometheus-independent state. The refresh
 * button is a hard nudge (bumps a nonce) — the underlying watches
 * update live, so it's mostly there to make the operator feel in
 * control while they wait for propagation.
 */

const DNSTroubleshootingPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [selectedHostname, setSelectedHostname] = React.useState<string | null>(null);
  // Nonce bumped by Refresh / Run-all-checks. Passed as a dep into
  // useDnsProber so a click re-fires POST /api/probe even when the
  // hostname hasn't changed. The K8s watches driving useDnsTroubleshooting
  // are list-watch, so they refresh on their own — the button only
  // needs to nudge the prober.
  const [proberNonce, setProberNonce] = React.useState(0);
  const runAllChecks = () => setProberNonce((n) => n + 1);
  const [createOpen, setCreateOpen] = React.useState(false);

  const flow = useDnsTroubleshooting(selectedHostname);
  // Live prober lookups when the pluginConfig ConfigMap carries a
  // dnsProberUrl. Falls through to the "install the companion" empty
  // state otherwise. See DNSResolverTable for the three-state matrix.
  const prober = useDnsProber(flow.hostname || null, proberNonce);

  // Starter YAML for the Create DNSPolicy empty-state CTA — pre-fills
  // `spec.targetRef.name` with the Gateway we already know needs the
  // policy, so the operator only has to fill in the provider Secret.
  const createStarter = React.useMemo(() => {
    const { template, yaml } = starterFor('DNSPolicy', flow.targetGateway?.namespace || 'openshift-ingress');
    if (!flow.targetGateway) return { template, yaml };
    // Rewrite the placeholder `<gateway-name>` in the starter so the
    // operator's target gateway appears there.
    const patched = yaml.replace(/<gateway-name>/g, flow.targetGateway.name);
    return { template, yaml: patched };
  }, [flow.targetGateway]);

  if (flow.loading) {
    return (
      <div className="rhcl-plugin-root rhcl-dns-page">
        <PageSection variant="default">
          <Title headingLevel="h1">{t('DNS')}</Title>
        </PageSection>
        <PageSection isFilled>
          <Bullseye>
            <Spinner size="xl" />
          </Bullseye>
        </PageSection>
      </div>
    );
  }

  // Empty-state short-circuit: a Gateway advertises a hostname but no
  // DNSPolicy is claiming it. Rendering the full pipeline in that case
  // would just paint six "Not configured" cards — worse than useless.
  // Show a proper CTA that opens the Create DNSPolicy modal with the
  // known target Gateway pre-filled so the operator's first click
  // matters.
  if (flow.needsDnsPolicy) {
    return (
      <div className="rhcl-plugin-root rhcl-dns-page">
        <PageSection variant="default">
          <Title headingLevel="h1">{t('DNS')}</Title>
        </PageSection>
        <PageSection isFilled>
          <Bullseye>
            <EmptyState
              titleText={t('No DNSPolicy for this Gateway')}
              headingLevel="h2"
              icon={GlobeIcon}
            >
              <EmptyStateBody>
                {t(
                  'Your Gateway "{{gw}}" advertises hostnames, but no DNSPolicy is publishing records for them. Create one to start managed DNS and unlock the full troubleshooting flow.',
                  { gw: flow.targetGateway?.name || 'unknown' },
                )}
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button variant="primary" icon={<PlusCircleIcon />} onClick={() => setCreateOpen(true)}>
                    {t('Create DNSPolicy')}
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          </Bullseye>
        </PageSection>
        <ResourceEditorModal
          isOpen={createOpen}
          mode="create"
          gvk={DNSPolicyGVK}
          plural="dnspolicies"
          starterYaml={createStarter.yaml}
          hint={createStarter.template.hint}
          onClose={() => setCreateOpen(false)}
        />
      </div>
    );
  }

  const overallMeta = STATUS_META[flow.overallStatus];
  const banner = (() => {
    if (flow.overallStatus === 'healthy') {
      return {
        cls: 'is-healthy',
        icon: <CheckCircleIcon style={{ color: STATUS_META.healthy.color, fontSize: 20 }} />,
        title: t('DNS is healthy'),
        body: t('Hostname resolves and every step in the pipeline is green.'),
      };
    }
    if (flow.overallStatus === 'not-configured') {
      return {
        cls: '',
        icon: <MinusCircleIcon style={{ color: STATUS_META['not-configured'].color, fontSize: 20 }} />,
        title: t('Nothing to troubleshoot yet'),
        body: t('No hostname is exposed by any Gateway or HTTPRoute. Create one to begin.'),
      };
    }
    return {
      cls: 'is-failing',
      icon:
        flow.overallStatus === 'pending' ? (
          <ClockIcon style={{ color: STATUS_META.pending.color, fontSize: 20 }} />
        ) : (
          <ExclamationCircleIcon style={{ color: overallMeta.color, fontSize: 20 }} />
        ),
      title: t('DNS configuration requires attention'),
      body: flow.primaryFailure
        ? t('Blocked at "{{title}}" step. See Diagnosis for the likely cause and next steps.', {
            title: flow.primaryFailure.title,
          })
        : t('One or more pipeline steps are not healthy.'),
    };
  })();

  return (
    <div className="rhcl-plugin-root rhcl-dns-page">
      <PageSection variant="default">
        <div className="rhcl-dns-header">
          <div className="rhcl-dns-header-left">
            <Title headingLevel="h1">{t('DNS')}</Title>
            <div style={{ fontSize: 14, color: 'var(--pf-t--global--text--color--subtle)' }}>
              {t('Visualize and debug DNS connectivity for your Kuadrant gateways.')}
            </div>
            <div className="rhcl-dns-hostname-picker">
              <label htmlFor="rhcl-dns-hostname" style={{ fontSize: 12, fontWeight: 600 }}>
                {t('Hostname')}
              </label>
              <select
                id="rhcl-dns-hostname"
                value={flow.hostname}
                onChange={(e) => setSelectedHostname(e.target.value)}
                disabled={flow.hostnameOptions.length === 0}
              >
                {flow.hostnameOptions.length === 0 ? (
                  <option>—</option>
                ) : (
                  flow.hostnameOptions.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))
                )}
              </select>
              <span
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  alignItems: 'center',
                  fontSize: 12,
                  color: overallMeta.color,
                }}
              >
                {overallMeta.label}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/*
              One button, one action: bump the prober nonce → the hook's
              useEffect fires → POST /api/probe with the current
              hostname + 8-resolver ladder. The K8s watches under
              useDnsTroubleshooting are already list-watch, so they
              refresh on their own. Previously there was a "Run all
              checks" button next to this one that drove the exact same
              code path — dropped because two buttons for the same
              behaviour read as "one of them must do more" and there
              wasn't a real second thing to do.
            */}
            <Button
              variant="primary"
              icon={<SyncAltIcon />}
              onClick={runAllChecks}
              isLoading={prober.loading}
              isDisabled={prober.loading}
            >
              {t('Refresh')}
            </Button>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <div className={`rhcl-dns-status-banner ${banner.cls}`}>
          {banner.icon}
          <div>
            <div style={{ fontWeight: 600 }}>{banner.title}</div>
            <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 2 }}>
              {banner.body}
            </div>
          </div>
        </div>

        <DNSFlowDiagram steps={flow.steps} />

        <div className="rhcl-dns-legend" aria-label={t('Status legend')}>
          <span><CheckCircleIcon style={{ color: STATUS_META.healthy.color }} /> {STATUS_META.healthy.label}</span>
          <span><ClockIcon style={{ color: STATUS_META.pending.color }} /> {STATUS_META.pending.label}</span>
          <span><ExclamationTriangleIcon style={{ color: STATUS_META.warning.color }} /> {STATUS_META.warning.label}</span>
          <span><ExclamationCircleIcon style={{ color: STATUS_META.failing.color }} /> {STATUS_META.failing.label}</span>
          <span><MinusCircleIcon style={{ color: STATUS_META.skipped.color }} /> {STATUS_META.skipped.label}</span>
          <span><MinusCircleIcon style={{ color: STATUS_META['not-configured'].color }} /> {STATUS_META['not-configured'].label}</span>
        </div>
      </PageSection>

      <PageSection>
        <Grid hasGutter>
          <GridItem lg={4} md={12}>
            <DNSTimeline events={flow.events} />
          </GridItem>
          <GridItem lg={4} md={12}>
            <DNSDiagnosticsTable checks={flow.checks} />
          </GridItem>
          <GridItem lg={4} md={12}>
            <DNSDiagnosisPanel flow={flow} />
          </GridItem>
        </Grid>
      </PageSection>

      <PageSection>
        <DNSResolverTable prober={prober} hostname={flow.hostname} isMultiSite={flow.isMultiSite} />
      </PageSection>

      <PageSection>
        <DNSAdvancedSection objects={flow.rawObjects} />
      </PageSection>
    </div>
  );
};

export default DNSTroubleshootingPage;
