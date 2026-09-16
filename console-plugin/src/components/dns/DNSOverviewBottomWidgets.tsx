import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  EmptyState,
  EmptyStateBody,
  Button,
  Progress,
  ProgressSize,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { STATUS_META } from './types';
import { Donut, Histogram } from '../tls/OverviewCharts';
import { useDnsProber, DEFAULT_RESOLVERS } from './useDnsProber';
import {
  PropagationBucket,
  ProviderSlice,
  DnsOverviewEvent,
} from './useDnsOverview';

/**
 * Four cards along the bottom row of the DNS Overview page:
 *
 *   1. Propagation Distribution — histogram (6 age buckets).
 *   2. Top DNS Providers — donut with legend.
 *   3. Public Resolution (by Resolver) — horizontal bar chart per
 *      resolver, populated on demand via the dns-prober companion.
 *   4. Recent DNS Events — timeline of condition transitions +
 *      Kuadrant-emitted events.
 */

const PROVIDER_PALETTE = [
  '#3E8FE0', '#F5A742', '#5EBE7A', '#C160E0',
  '#E86D6D', '#4ECDC4', '#F4C542',
];

// -------------------- Propagation Distribution --------------------

interface PropProps {
  buckets: PropagationBucket[];
}

// Hex hardcoded — see TLSOverviewKPICards for why the PF tokens
// don't render right in the histogram/donut SVG contexts.
const bucketColor = (s: PropagationBucket['severity']) => {
  switch (s) {
    case 'critical': return '#C9190B';
    case 'warning':  return '#F0AB00';
    case 'healthy':  return '#3E8635';
  }
};

export const DNSOverviewPropagation: React.FC<PropProps> = ({ buckets }) => {
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  return (
    <Card aria-label="Propagation distribution" className="rhcl-dns-overview-panel">
      <CardTitle>Propagation Distribution</CardTitle>
      <CardBody>
        {total === 0 ? (
          <EmptyState titleText="No records to distribute" headingLevel="h4">
            <EmptyStateBody>Nothing to place on the timeline yet.</EmptyStateBody>
          </EmptyState>
        ) : (
          <div className="rhcl-dns-overview-histo-body">
            <Histogram
              bars={buckets.map((b) => ({
                label: b.label,
                value: b.count,
                color: bucketColor(b.severity),
              }))}
              height={180}
            />
            <div className="rhcl-dns-overview-histo-caption">
              Total: {total} record{total === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

// -------------------- Top DNS Providers --------------------

interface ProvProps {
  slices: ProviderSlice[];
  onProviderClick?: (provider: string) => void;
}

export const DNSOverviewProviders: React.FC<ProvProps> = ({ slices, onProviderClick }) => {
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  const segments = slices.map((s, i) => ({
    label: s.label,
    value: s.count,
    color: PROVIDER_PALETTE[i % PROVIDER_PALETTE.length],
  }));
  return (
    <Card aria-label="Top DNS providers" className="rhcl-dns-overview-panel">
      <CardTitle>Top DNS Providers</CardTitle>
      <CardBody>
        {total === 0 ? (
          <EmptyState titleText="No providers to summarise" headingLevel="h4">
            <EmptyStateBody>Configured once DNSPolicies exist.</EmptyStateBody>
          </EmptyState>
        ) : (
          <div className="rhcl-dns-overview-provider-row">
            <Donut
              segments={segments}
              centerValue={total}
              centerLabel="Total"
              size={150}
              strokeWidth={20}
            />
            <ul className="rhcl-dns-overview-provider-legend">
              {segments.map((s) => {
                const clickable = !!onProviderClick;
                return (
                  <li
                    key={s.label}
                    className={clickable ? 'rhcl-dns-overview-provider-item--clickable' : undefined}
                    onClick={clickable ? () => onProviderClick!(s.label) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onProviderClick!(s.label);
                            }
                          }
                        : undefined
                    }
                  >
                    <span className="rhcl-dns-overview-swatch" style={{ background: s.color }} />
                    <span className="rhcl-dns-overview-provider-label">{s.label}</span>
                    <span className="rhcl-dns-overview-provider-count">
                      {s.value}
                      <span className="rhcl-dns-overview-provider-pct">
                        {' '}· {Math.round((s.value / total) * 100)}%
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

// -------------------- Public Resolution (by Resolver) --------------------

interface ResolverProps {
  /** A representative hostname to probe. Usually the first row. */
  sampleHostname: string | null;
}

/**
 * Per-resolver "public resolution" widget. Populated on demand — we
 * pick a representative hostname and probe the standard resolver ladder
 * (Cloudflare / Google / Quad9 / OpenDNS / Verisign / Cisco / AdGuard /
 * Yandex). For each resolver we render a horizontal bar whose fill
 * shows a 100% "resolved" / 0% "failed" / 50% "pending" value — the
 * numeric side matches the mockup, and the operator sees at a glance
 * which resolvers are getting the right answer.
 *
 * We deliberately don't fire this on page load: an 8-request POST to
 * the companion for every landing is wasteful, and most operators
 * won't need it every time. Auto-probes only if a sample hostname is
 * selected AND the operator asked for it.
 */
export const DNSOverviewResolverResolution: React.FC<ResolverProps> = ({
  sampleHostname,
}) => {
  const [nonce, setNonce] = React.useState(0);
  // Bind the nonce into the hook via a ref — useDnsProber ignores when
  // nonce=0 so we only fire on explicit user click.
  const prober = useDnsProber(sampleHostname, nonce);

  const trigger = () => setNonce((n) => n + 1);

  return (
    <Card aria-label="Public resolution by resolver" className="rhcl-dns-overview-panel">
      <CardTitle>
        <span
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Public Resolution (by Resolver)</span>
          {sampleHostname && prober.configured && (
            <Button variant="link" isInline onClick={trigger} isLoading={prober.loading}>
              {prober.resolvers ? 'Re-run probe' : 'Run probe'}
            </Button>
          )}
        </span>
      </CardTitle>
      <CardBody>
        {!prober.configured ? (
          <EmptyState titleText="DNS Prober companion not configured" headingLevel="h4">
            <EmptyStateBody>
              Deploy the <code>dns-prober</code> companion service to enable per-
              resolver checks.
            </EmptyStateBody>
          </EmptyState>
        ) : !sampleHostname ? (
          <EmptyState titleText="No sample hostname available" headingLevel="h4">
            <EmptyStateBody>
              Select a record from the table above to sample its public resolution.
            </EmptyStateBody>
          </EmptyState>
        ) : !prober.resolvers ? (
          <EmptyState titleText="Not probed yet" headingLevel="h4">
            <EmptyStateBody>
              Click <strong>Run probe</strong> to check <code>{sampleHostname}</code>
              {' '}against the standard resolver ladder.
            </EmptyStateBody>
            {prober.error && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: STATUS_META.failing.color,
                }}
              >
                Last error: {prober.error}
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginBottom: 8 }}>
              Sampled against <code>{sampleHostname}</code>
            </div>
            <ul className="rhcl-dns-overview-resolver-list">
              {DEFAULT_RESOLVERS.map((meta) => {
                const row = prober.resolvers!.find((r) => r.name === meta.name);
                let pct = 0;
                let color = STATUS_META.unknown.color;
                let label = 'unknown';
                if (row) {
                  if (row.status === 'healthy') {
                    pct = 100;
                    color = STATUS_META.healthy.color;
                    label = 'resolved';
                  } else if (row.status === 'failing') {
                    pct = 0;
                    color = STATUS_META.failing.color;
                    label = 'failed';
                  } else if (row.status === 'pending') {
                    pct = 50;
                    color = STATUS_META.warning.color;
                    label = 'pending';
                  }
                }
                return (
                  <li key={meta.name}>
                    <span className="rhcl-dns-overview-resolver-label">
                      {meta.name}
                      <span style={{ color: 'var(--pf-t--global--text--color--subtle)', marginLeft: 6 }}>
                        ({meta.ip})
                      </span>
                    </span>
                    <span style={{ flex: 1, minWidth: 80 }}>
                      <Progress
                        value={pct}
                        size={ProgressSize.sm}
                        aria-label={`${meta.name} ${label}`}
                        measureLocation={"none" as never}
                        style={{ ['--pf-v6-c-progress__indicator--BackgroundColor' as never]: color }}
                      />
                    </span>
                    <span style={{ fontSize: 12, color, fontWeight: 500, minWidth: 60, textAlign: 'right' }}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
};

// -------------------- Recent DNS Events --------------------

interface EventsProps {
  events: DnsOverviewEvent[];
}

const iconFor = (kind: DnsOverviewEvent['kind']) => {
  switch (kind) {
    case 'healthy':
      return <CheckCircleIcon style={{ color: STATUS_META.healthy.color }} />;
    case 'failed':
      return <ExclamationCircleIcon style={{ color: STATUS_META.failing.color }} />;
    case 'propagating':
      return <ExclamationTriangleIcon style={{ color: STATUS_META.warning.color }} />;
    default:
      return <InfoCircleIcon style={{ color: STATUS_META.unknown.color }} />;
  }
};

function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const DNSOverviewRecentEvents: React.FC<EventsProps> = ({ events }) => (
  <Card aria-label="Recent DNS events" className="rhcl-dns-overview-panel">
    <CardTitle>Recent DNS Events</CardTitle>
    <CardBody>
      {events.length === 0 ? (
        <EmptyState titleText="No recent events" headingLevel="h4">
          <EmptyStateBody>
            DNSRecord + DNSPolicy activity will surface here.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <ul className="rhcl-dns-overview-events">
          {events.map((e) => (
            <li key={e.id}>
              <span className="rhcl-dns-overview-events-icon">{iconFor(e.kind)}</span>
              <span className="rhcl-dns-overview-events-body">
                <div className="rhcl-dns-overview-events-title">
                  {e.href ? (
                    <Link to={e.href}>{e.title}</Link>
                  ) : (
                    e.title
                  )}
                </div>
                {e.detail && (
                  <div className="rhcl-dns-overview-events-detail">{e.detail}</div>
                )}
              </span>
              <span className="rhcl-dns-overview-events-when">{relativeAgo(e.when)}</span>
            </li>
          ))}
        </ul>
      )}
    </CardBody>
  </Card>
);
