import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Flex,
  FlexItem,
  Title,
  Spinner,
  Tooltip,
  Button,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { HTTPRoute } from '../../../types';
import { hostnameToURL } from '../../../utils/hostname';
import {
  CheckStatusLabel,
  FeatureStatusLabel,
  SecurityPostureBadge,
} from './SecurityAtoms';
import {
  RouteOperationalStatus,
  RouteSecuritySummary,
  SecurityFeatureSummary,
} from './routeSecurityTypes';

interface DetailsCardProps {
  route: HTTPRoute;
  parentGatewayName: string;
  parentGatewayNamespace: string;
}

export const HTTPRouteDetailsCard: React.FC<DetailsCardProps> = ({
  route,
  parentGatewayName,
  parentGatewayNamespace,
}) => {
  const ns = route.metadata?.namespace || '';
  const name = route.metadata?.name || '';
  const hostnames = route.spec?.hostnames || [];
  const created = route.metadata?.creationTimestamp
    ? new Date(route.metadata.creationTimestamp).toLocaleString()
    : '-';

  return (
    <Card isFullHeight>
      <CardTitle>Details</CardTitle>
      <CardBody>
        <DescriptionList isCompact isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Name</DescriptionListTerm>
            <DescriptionListDescription>{name}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Namespace</DescriptionListTerm>
            <DescriptionListDescription>
              <Link to={`/k8s/cluster/namespaces/${ns}`}>{ns}</Link>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Parent Gateway</DescriptionListTerm>
            <DescriptionListDescription>
              {parentGatewayName ? (
                <Link
                  to={`/connectivity-link/gateways/${parentGatewayNamespace || ns}/${parentGatewayName}`}
                >
                  {parentGatewayName}
                </Link>
              ) : (
                '-'
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Hostnames</DescriptionListTerm>
            <DescriptionListDescription>
              {hostnames.length > 0 ? (
                hostnames.map((h) => (
                  <div key={h}>
                    <a
                      href={hostnameToURL(h)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {h} <ExternalLinkAltIcon style={{ verticalAlign: -1 }} />
                    </a>
                  </div>
                ))
              ) : (
                '-'
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Created</DescriptionListTerm>
            <DescriptionListDescription>{created}</DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </CardBody>
    </Card>
  );
};

interface StatusCardProps {
  operational: RouteOperationalStatus;
}

export const HTTPRouteStatusCard: React.FC<StatusCardProps> = ({ operational }) => {
  return (
    <Card isFullHeight>
      <CardTitle>Status</CardTitle>
      <CardBody>
        <DescriptionList isCompact isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Accepted</DescriptionListTerm>
            <DescriptionListDescription>
              <CheckStatusLabel status={operational.accepted} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Resolved References</DescriptionListTerm>
            <DescriptionListDescription>
              <CheckStatusLabel status={operational.resolvedRefs} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Programmed</DescriptionListTerm>
            <DescriptionListDescription>
              <CheckStatusLabel status={operational.programmed} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Degraded</DescriptionListTerm>
            <DescriptionListDescription>
              <CheckStatusLabel status={operational.degraded} />
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
        {operational.reason && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--pf-t--global--color--status--danger--default)' }}>
            <strong>{operational.reason}</strong>
            {operational.message ? `: ${operational.message}` : ''}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

interface SecuritySummaryProps {
  summary: RouteSecuritySummary;
  onNavigateToSecurityTab: () => void;
}

export const HTTPRouteSecuritySummaryCard: React.FC<SecuritySummaryProps> = ({
  summary,
  onNavigateToSecurityTab,
}) => {
  const featureRow = (label: string, s: SecurityFeatureSummary) => (
    <Flex
      key={label}
      justifyContent={{ default: 'justifyContentSpaceBetween' }}
      alignItems={{ default: 'alignItemsCenter' }}
      style={{ marginTop: 4 }}
    >
      <FlexItem>
        <span style={{ fontWeight: 500 }}>{label}</span>
      </FlexItem>
      <FlexItem>
        <Tooltip content={s.description || s.label}>
          <span>
            <FeatureStatusLabel status={s.status} label={s.label} />
          </span>
        </Tooltip>
      </FlexItem>
    </Flex>
  );

  return (
    <Card isFullHeight>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>Security Summary</FlexItem>
          <FlexItem>
            <SecurityPostureBadge posture={summary.posture} reason={summary.postureReason} />
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--pf-t--global--text--color--subtle)' }}>
          {summary.postureReason}
        </div>
        {featureRow('TLS', summary.tls)}
        {featureRow('Authentication', summary.authentication)}
        {featureRow('Rate Limit', summary.rateLimiting)}
        {featureRow('Headers', summary.headers)}
        <div style={{ marginTop: 12 }}>
          <Button variant="link" isInline onClick={onNavigateToSecurityTab}>
            Open Security tab
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

interface TrafficSummaryProps {
  requestsPerMin: number | undefined;
  errorPct: number | undefined;
  p95LatencyMs?: number;
  loaded: boolean;
  onOpenGrafana: () => void;
}

export const HTTPRouteTrafficSummaryCard: React.FC<TrafficSummaryProps> = ({
  requestsPerMin,
  errorPct,
  p95LatencyMs,
  loaded,
  onOpenGrafana,
}) => {
  if (!loaded) {
    return (
      <Card isFullHeight>
        <CardTitle>Traffic Summary</CardTitle>
        <CardBody>
          <Spinner size="md" />
        </CardBody>
      </Card>
    );
  }

  const hasMetrics = requestsPerMin != null || errorPct != null;
  return (
    <Card isFullHeight>
      <CardTitle>Traffic Summary – Last 5 min</CardTitle>
      <CardBody>
        {hasMetrics ? (
          <DescriptionList isCompact isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>Requests / min</DescriptionListTerm>
              <DescriptionListDescription>
                {requestsPerMin != null ? Math.round(requestsPerMin).toLocaleString() : '-'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Error rate</DescriptionListTerm>
              <DescriptionListDescription>
                {errorPct != null ? `${errorPct.toFixed(1)}%` : '-'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Success rate</DescriptionListTerm>
              <DescriptionListDescription>
                {errorPct != null ? `${(100 - errorPct).toFixed(1)}%` : '-'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            {p95LatencyMs != null && (
              <DescriptionListGroup>
                <DescriptionListTerm>P95 latency</DescriptionListTerm>
                <DescriptionListDescription>{p95LatencyMs} ms</DescriptionListDescription>
              </DescriptionListGroup>
            )}
          </DescriptionList>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
            <Title headingLevel="h4" style={{ marginBottom: 4 }}>Metrics unavailable</Title>
            No Prometheus data was returned for this route yet.
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="link" isInline onClick={onOpenGrafana}>
            Open in Grafana
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};
