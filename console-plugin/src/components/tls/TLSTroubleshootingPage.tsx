import * as React from 'react';
import {
  PageSection,
  Title,
  Flex,
  FlexItem,
  Button,
  Spinner,
  Bullseye,
  Alert,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import { SyncAltIcon, LockIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { STATUS_META } from '../dns/types';
import { useTlsTroubleshooting } from './useTlsTroubleshooting';
import TLSStatusCards from './TLSStatusCards';
import TLSJourneyFlow from './TLSJourneyFlow';
import TLSRootCausePanel from './TLSRootCausePanel';
import TLSSmartRecommendations from './TLSSmartRecommendations';
import TLSCommandsPanel from './TLSCommandsPanel';
import TLSExternalLinksPanel from './TLSExternalLinksPanel';
import TLSCertificateDetailsCard from './TLSCertificateDetailsCard';
import TLSCertificateLifetimeCard from './TLSCertificateLifetimeCard';
import TLSHTTPSValidationCard from './TLSHTTPSValidationCard';
import TLSDiagnosticsTable from './TLSDiagnosticsTable';
import TLSTimeline from './TLSTimeline';
import './tls-troubleshooting.css';
import '../dns/dns-troubleshooting.css';

/**
 * Full TLS Troubleshooting page. Layout at a glance:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Header (title, hostname picker, Refresh)                      │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ 5 KPI cards                                                   │
 *   ├──────────────────────────────────────┬────────────────────────┤
 *   │ TLS Journey (9-step flow)            │ Root Cause             │
 *   │                                      │                        │
 *   │ Cert Details │ Cert Lifetime │ HTTPS │ Smart Recommendations  │
 *   │                                      │                        │
 *   │ Diagnostics table │ Timeline         │ Useful Commands        │
 *   │                                      │                        │
 *   │                                      │ External Links         │
 *   └──────────────────────────────────────┴────────────────────────┘
 *
 * The 3-column layout mirrors DNSTroubleshootingPage on purpose so the
 * operator's muscle memory transfers.
 */

const TLSTroubleshootingPage: React.FC = () => {
  const [selectedHostname, setSelectedHostname] = React.useState<string | null>(null);
  const [tickKey, setTickKey] = React.useState(0);
  void tickKey; // Refresh nudges React to re-render even though watches auto-update.
  const flow = useTlsTroubleshooting(selectedHostname);

  const refresh = React.useCallback(() => setTickKey((k) => k + 1), []);

  if (flow.loading) {
    return (
      <div className="rhcl-plugin-root rhcl-dns-page">
        <PageSection>
          <Bullseye>
            <Spinner size="lg" />
          </Bullseye>
        </PageSection>
      </div>
    );
  }

  const overallColor = STATUS_META[flow.overall.overall].color;

  return (
    <div className="rhcl-plugin-root rhcl-dns-page rhcl-tls-page">
      <PageSection variant="default">
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem grow={{ default: 'grow' }}>
            <Title headingLevel="h1">
              <LockIcon style={{ marginRight: 8 }} />
              TLS
            </Title>
            <div
              style={{
                marginTop: 4,
                fontSize: 14,
                color: 'var(--pf-v5-global--Color--200)',
              }}
            >
              Diagnose certificate issuance, HTTPS connectivity and Gateway TLS configuration.
            </div>
            <div className="rhcl-dns-hostname-picker">
              <label htmlFor="tls-hostname">Hostname</label>
              <select
                id="tls-hostname"
                value={flow.hostname}
                onChange={(e) => setSelectedHostname(e.target.value)}
                disabled={flow.hostnameOptions.length === 0}
              >
                {flow.hostnameOptions.length === 0 ? (
                  <option value="">No hostnames declared on any Gateway</option>
                ) : (
                  flow.hostnameOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))
                )}
              </select>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: overallColor,
                }}
              >
                {STATUS_META[flow.overall.overall].label}
              </span>
            </div>
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              {flow.headerLinks.openCertificate && (
                <FlexItem>
                  <Button
                    variant="secondary"
                    component={(props) => <Link {...props} to={flow.headerLinks.openCertificate!} />}
                  >
                    Open Certificate
                  </Button>
                </FlexItem>
              )}
              {flow.headerLinks.openGateway && (
                <FlexItem>
                  <Button
                    variant="secondary"
                    component={(props) => <Link {...props} to={flow.headerLinks.openGateway!} />}
                  >
                    Open Gateway
                  </Button>
                </FlexItem>
              )}
              <FlexItem>
                <Button
                  variant="plain"
                  aria-label="Refresh"
                  onClick={refresh}
                >
                  <SyncAltIcon />
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Empty state — no TLSPolicy anywhere, so nothing to troubleshoot yet. */}
      {flow.needsTlsPolicy && (
        <PageSection>
          <Alert
            variant="info"
            title="No TLSPolicy configured"
            actionLinks={
              <Button
                variant="link"
                isInline
                component={(props) => (
                  <Link {...props} to={`/connectivity-link/policies/create/tlspolicy`} />
                )}
              >
                Create TLSPolicy
              </Button>
            }
          >
            Your Gateway advertises HTTPS listeners, but no TLSPolicy is publishing certificates
            for them. Create one to start managed TLS and unlock the full troubleshooting flow.
          </Alert>
        </PageSection>
      )}

      {/* 5 KPI cards */}
      <PageSection>
        <TLSStatusCards overall={flow.overall} />
      </PageSection>

      {/* Journey + Root Cause */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={9} md={12}>
            <div className="rhcl-tls-panel rhcl-tls-panel--flush">
              <div className="rhcl-tls-section-head">
                <Title headingLevel="h3" size="lg">
                  TLS Journey
                </Title>
                <div className="rhcl-tls-section-sub">
                  Follow the end-to-end certificate lifecycle.
                </div>
              </div>
              <TLSJourneyFlow steps={flow.steps} />
            </div>
          </GridItem>
          <GridItem lg={3} md={12}>
            <TLSRootCausePanel primaryFailure={flow.primaryFailure} />
          </GridItem>
        </Grid>
      </PageSection>

      {/* Cert Details + Lifetime + HTTPS */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={4} md={12}>
            <TLSCertificateDetailsCard
              cert={flow.certificate}
              openCertificate={flow.headerLinks.openCertificate}
            />
          </GridItem>
          <GridItem lg={4} md={12}>
            <TLSCertificateLifetimeCard cert={flow.certificate} />
          </GridItem>
          <GridItem lg={4} md={12}>
            <TLSHTTPSValidationCard hostname={flow.hostname} />
          </GridItem>
        </Grid>
      </PageSection>

      {/* Diagnostics + Timeline (left) alongside Recommendations + Commands + Links (right) */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={8} md={12}>
            <Grid hasGutter>
              <GridItem md={12}>
                <TLSDiagnosticsTable checks={flow.checks} onRunAll={refresh} />
              </GridItem>
              <GridItem md={12}>
                <TLSTimeline events={flow.timeline} />
              </GridItem>
            </Grid>
          </GridItem>
          <GridItem lg={4} md={12}>
            <Grid hasGutter>
              <GridItem md={12}>
                <TLSSmartRecommendations recommendations={flow.recommendations} />
              </GridItem>
              <GridItem md={12}>
                <TLSCommandsPanel
                  hostname={flow.hostname}
                  gatewayName={flow.targetGateway?.name}
                  gatewayNamespace={flow.targetGateway?.namespace}
                  certificateName={flow.certificate?.name}
                  certificateNamespace={flow.certificate?.namespace}
                  secretName={flow.certificate?.secretName}
                  secretNamespace={flow.targetGateway?.namespace}
                />
              </GridItem>
              <GridItem md={12}>
                <TLSExternalLinksPanel
                  externalLinks={flow.externalLinks}
                  headerLinks={flow.headerLinks}
                />
              </GridItem>
            </Grid>
          </GridItem>
        </Grid>
      </PageSection>
    </div>
  );
};

export default TLSTroubleshootingPage;
