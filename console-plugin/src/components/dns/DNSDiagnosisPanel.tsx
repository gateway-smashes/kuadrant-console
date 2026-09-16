import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Content,
  ClipboardCopy,
  ExpandableSection,
  Button,
} from '@patternfly/react-core';
import {
  ExclamationCircleIcon,
  CheckCircleIcon,
  ExternalLinkAltIcon,
  ClockIcon,
} from '@patternfly/react-icons';
import { DnsFlow, DnsStep } from './types';
import { OpenInGrafanaButton } from '../common/OpenInGrafanaButton';

/**
 * "What's wrong and what should I do about it" — the diagnosis card.
 * Not a generic error surface: it inspects the `primaryFailure` step
 * and picks a catalogue entry from `DIAGNOSIS_MAP` that carries
 * copy-ready root cause + recommended actions + a small useful-commands
 * block. When everything is healthy it collapses to a positive banner.
 */

interface Props {
  flow: DnsFlow;
}

interface DiagnosisEntry {
  /** Short sentence rendered as the "Likely issue" headline. */
  headline: string;
  /** One-paragraph explanation shown right under the headline. */
  body: string;
  actions: string[];
  /** Copy-ready commands relevant to this failure. */
  commands: string[];
}

/** Catalogue keyed by (step id + status). Falls back through progressively
 *  less specific matches — status-only, then step-only — so a new status
 *  we haven't authored copy for still surfaces the right step's docs. */
const DIAGNOSIS_MAP: Record<string, DiagnosisEntry> = {
  'hostname:not-configured': {
    headline: 'No hostname declared',
    body: 'No Gateway listener or HTTPRoute exposes a hostname yet. DNS troubleshooting has nothing to trace until a hostname is declared somewhere.',
    actions: [
      'Add a `hostname` field on a Gateway listener, or',
      'Declare `spec.hostnames` on an HTTPRoute pointing at the Gateway.',
    ],
    commands: [
      'oc get gateways -A',
      'oc get httproutes -A',
    ],
  },
  'dnspolicy:not-configured': {
    headline: 'No DNSPolicy targets this Gateway',
    body: 'A Gateway serves the hostname but no DNSPolicy is asking Kuadrant to publish records for it. Public consumers will not resolve the hostname until a DNSPolicy is attached.',
    actions: [
      'Create a DNSPolicy targeting this Gateway.',
      'Reference a provider Secret (Route 53 / Cloud DNS / Azure DNS).',
    ],
    commands: [
      'oc get dnspolicy -A',
      'oc explain dnspolicy.spec',
    ],
  },
  'dnspolicy:failing': {
    headline: 'DNSPolicy is not accepted',
    body: 'Kuadrant rejected the DNSPolicy. Records will not be written until the policy is accepted.',
    actions: [
      'Inspect the DNSPolicy status conditions for the specific rejection reason.',
      'Verify the providerRefs Secret exists in the same namespace.',
      'Confirm the targetRef points at a valid Gateway.',
    ],
    commands: [
      'oc describe dnspolicy -A',
      'oc get events -A --field-selector involvedObject.kind=DNSPolicy',
    ],
  },
  'dnspolicy:pending': {
    headline: 'DNSPolicy accepted, waiting to be enforced',
    body: 'Kuadrant accepted the policy but has not written records yet. Usually a transient state during reconciliation.',
    actions: [
      'Wait a minute and refresh.',
      'Check the Kuadrant operator logs if it persists.',
    ],
    commands: [
      'oc -n kuadrant-system logs deploy/kuadrant-operator-controller-manager',
    ],
  },
  'gateway:not-configured': {
    headline: 'No Gateway serves this hostname',
    body: 'DNSPolicy exists in the cluster but no Gateway listener carries the hostname yet.',
    actions: [
      'Add a listener with the matching hostname on your Gateway, or',
      'Change the DNSPolicy target to a Gateway that already covers this hostname.',
    ],
    commands: [
      'oc get gateway -A -o wide',
    ],
  },
  'gateway:failing': {
    headline: 'Gateway is not accepted',
    body: 'Sail / Istio did not accept the Gateway. Records will not be advertised until the underlying data plane is programmed.',
    actions: [
      'Check the Gateway status conditions.',
      'Confirm the gatewayClassName is installed on the cluster.',
      'Look at Istio / Envoy logs for the Gateway pod.',
    ],
    commands: [
      'oc describe gateway',
      'oc get gatewayclass',
    ],
  },
  'provider:failing': {
    headline: 'DNSPolicy has no provider Secret',
    body: 'The DNSPolicy lacks `providerRefs`, so Kuadrant has no cloud credentials to write records with. The record will never appear on public DNS.',
    actions: [
      'Create a Secret with your provider credentials.',
      'Add `providerRefs: [{ name: <secret> }]` to the DNSPolicy.',
    ],
    commands: [
      'oc explain dnspolicy.spec.providerRefs',
    ],
  },
  'public-dns:pending': {
    headline: 'DNS record not yet propagated',
    body: 'The record was written at the provider but some public resolvers still return NXDOMAIN. Propagation typically completes within a few minutes.',
    actions: [
      'Wait a few minutes and refresh diagnostics.',
      'Verify the provider credentials.',
      'Confirm the hosted zone matches the hostname suffix.',
    ],
    commands: [
      'dig @1.1.1.1 <hostname>',
      'dig @8.8.8.8 <hostname>',
    ],
  },
  'httproute:not-configured': {
    headline: 'No HTTPRoute attached to the Gateway',
    body: 'Nothing is telling the Gateway what to do with traffic arriving on this hostname. Requests will 404 even after DNS resolves.',
    actions: [
      'Create an HTTPRoute with `spec.hostnames: [<hostname>]` and `spec.parentRefs: [<gateway>]`.',
    ],
    commands: [
      'oc get httproute -A',
    ],
  },
  'httproute:failing': {
    headline: 'HTTPRoute rejected by the Gateway',
    body: 'The HTTPRoute exists but was not accepted. Check the parent-conditions on the route status.',
    actions: [
      'Inspect the HTTPRoute status parents/conditions.',
      'Ensure the listener the route claims exists on the Gateway.',
      'Check that `allowedRoutes.namespaces.from` permits your route namespace.',
    ],
    commands: [
      'oc describe httproute <name>',
    ],
  },
  'backend:failing': {
    headline: 'HTTPRoute backendRefs do not resolve',
    body: 'One or more `backendRefs` on the HTTPRoute point at a Service that does not exist in the route\'s namespace (or is misnamed).',
    actions: [
      'Verify the referenced Services exist and are named correctly.',
      'Confirm the target port matches a `port` on the Service.',
      'Check pods behind the Service are Ready.',
    ],
    commands: [
      'oc get svc',
      'oc get endpoints',
    ],
  },
};

function pickDiagnosis(step: DnsStep | null): DiagnosisEntry | null {
  if (!step) return null;
  const specific = DIAGNOSIS_MAP[`${step.id}:${step.status}`];
  if (specific) return specific;
  // Fall back to first entry that mentions this step, if we haven't
  // authored copy for the specific status yet. Best-effort.
  const stepOnly = Object.entries(DIAGNOSIS_MAP).find(([k]) => k.startsWith(`${step.id}:`));
  return stepOnly ? stepOnly[1] : null;
}

const DNSDiagnosisPanel: React.FC<Props> = ({ flow }) => {
  const [showTools, setShowTools] = React.useState(false);
  const diagnosis = pickDiagnosis(flow.primaryFailure);

  if (!diagnosis) {
    return (
      <Card aria-label="Diagnosis">
        <CardTitle>Diagnosis</CardTitle>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pf-t--global--color--status--success--default)' }}>
            <CheckCircleIcon />
            <strong>DNS is healthy</strong>
          </div>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
            All checks passed. Records exist at the provider and public resolvers return the
            expected IP.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card aria-label="Diagnosis">
      <CardTitle>Diagnosis</CardTitle>
      <CardBody>
        <div className="rhcl-dns-diagnosis-heading">
          <ExclamationCircleIcon style={{ color: 'var(--pf-t--global--color--status--danger--default)' }} />
          <div>
            <div style={{ fontWeight: 600 }}>{diagnosis.headline}</div>
            <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)', marginTop: 4 }}>
              {diagnosis.body}
            </div>
          </div>
        </div>

        <Content style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>
            Recommended actions
          </h4>
          <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13 }}>
            {diagnosis.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </Content>

        <ExpandableSection
          toggleText="Useful commands"
          isExpanded={showTools}
          onToggle={(_e, v) => setShowTools(v)}
          isIndented
        >
          <div style={{ display: 'grid', gap: 6 }}>
            {diagnosis.commands.map((c) => (
              <ClipboardCopy key={c} isReadOnly variant="inline-compact" hoverTip="Copy" clickTip="Copied">
                {c.replace('<hostname>', flow.hostname || '<hostname>')}
              </ClipboardCopy>
            ))}
          </div>
        </ExpandableSection>

        <Content style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>External tools</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/*
              Grafana + Prometheus deep-links: the api-overview dashboard
              is the closest thing we ship to "DNS observability" —
              request rate + gateway upstream errors surface DNS+TLS
              handshake issues indirectly. Not perfect, but useful when
              the operator wants to correlate a propagation window with
              real traffic. OpenInGrafanaButton falls back to a disabled
              tooltip when Grafana isn't installed, so we don't have to
              guard here.
            */}
            <OpenInGrafanaButton
              dashboard="api-overview"
              label="Gateway metrics"
              variant="link"
              isInline
            />
            {/*
              Prometheus deep-link goes to Console's native metrics
              browser. `histio_request_duration_milliseconds_bucket` is
              the closest we have to "gateway latency"; the URL takes a
              PromQL query and shows a graph.
            */}
            <Button
              variant="link"
              isInline
              component="a"
              href={`/monitoring/query-browser?query=${encodeURIComponent(
                `sum by (le) (rate(istio_request_duration_milliseconds_bucket{destination_service_namespace="openshift-ingress"}[5m]))`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLinkAltIcon />}
              iconPosition="right"
            >
              Prometheus
            </Button>
            <Button
              variant="link"
              isInline
              component="a"
              href={`https://www.whatsmydns.net/#A/${encodeURIComponent(flow.hostname || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLinkAltIcon />}
              iconPosition="right"
            >
              DNS Checker
            </Button>
            <Button
              variant="link"
              isInline
              component="a"
              href={`https://tools.dnstools.com/whois/${encodeURIComponent(flow.hostname || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLinkAltIcon />}
              iconPosition="right"
            >
              WHOIS lookup
            </Button>
          </div>
        </Content>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
          <ClockIcon /> Estimated propagation window: 2–15 minutes typical for TTL 60s records.
        </div>
      </CardBody>
    </Card>
  );
};

export default DNSDiagnosisPanel;
