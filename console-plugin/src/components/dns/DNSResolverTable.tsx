import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Tooltip,
  Label,
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Spinner,
  Button,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
} from '@patternfly/react-table';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  OutlinedQuestionCircleIcon,
  GlobeIcon,
  ExternalLinkAltIcon,
} from '@patternfly/react-icons';
import { DnsResolver, STATUS_META } from './types';
import { UseDnsProberResult } from './useDnsProber';
import DNSResolverMap from './DNSResolverMap';

/**
 * Cross-resolver table. Three states, mutually exclusive:
 *
 *   1. **Prober NOT configured** — EmptyState explaining the companion
 *      service is required, with a link to its install docs.
 *
 *   2. **Prober configured but errored / empty** — EmptyState with the
 *      error message. We deliberately do NOT fall back to a simulated
 *      view here: a fake table pretending to be real is worse than a
 *      clear "no data" screen.
 *
 *   3. **Prober configured + reachable + returned rows** — the actual
 *      per-resolver table. Header carries a green `Live` label and the
 *      last-probed timestamp.
 */

interface Props {
  prober: UseDnsProberResult;
  hostname: string;
  /** True when the DNSRecord CR shows more than one owner cluster
   *  publishing endpoints — the authoritative signal that a "different
   *  IPs per resolver" pattern actually implies multi-cluster geo
   *  routing. Passed through so the map can pick between the "expected:
   *  same origin, different AZs" and "expected: multi-cluster" copy. */
  isMultiSite: boolean;
}

const StatusChip: React.FC<{ r: DnsResolver }> = ({ r }) => {
  const style = { color: STATUS_META[r.status].color, fontSize: 14 };
  let icon: React.ReactNode;
  switch (r.status) {
    case 'healthy':
      icon = <CheckCircleIcon style={style} />;
      break;
    case 'pending':
      icon = <ClockIcon style={style} />;
      break;
    case 'failing':
      icon = <ExclamationCircleIcon style={style} />;
      break;
    default:
      icon = <OutlinedQuestionCircleIcon style={style} />;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: STATUS_META[r.status].color }}>
      {icon}
      {r.result}
    </span>
  );
};

const ResolverRows: React.FC<{ rows: DnsResolver[] }> = ({ rows }) => (
  <Table aria-label="Public resolvers" variant="compact" borders={false}>
    <Thead>
      <Tr>
        <Th>Resolver</Th>
        <Th>Location</Th>
        <Th>IP</Th>
        <Th>Result</Th>
        <Th>Response time</Th>
        <Th>Last checked</Th>
      </Tr>
    </Thead>
    <Tbody>
      {rows.map((r) => (
        <Tr key={r.name}>
          <Td>{r.name}</Td>
          <Td>{r.location}</Td>
          <Td><code style={{ fontSize: 12 }}>{r.ip}</code></Td>
          <Td><StatusChip r={r} /></Td>
          <Td>{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</Td>
          <Td>
            <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
              {r.lastCheckedIso ? new Date(r.lastCheckedIso).toLocaleTimeString() : '—'}
            </span>
          </Td>
        </Tr>
      ))}
    </Tbody>
  </Table>
);

const DNSResolverTable: React.FC<Props> = ({ prober, hostname, isMultiSite }) => {
  // Case 1: prober not configured — full-height empty state.
  if (!prober.configured) {
    return (
      <Card aria-label="DNS resolution preview">
        <CardTitle>DNS resolution preview</CardTitle>
        <CardBody>
          <EmptyState
            titleText="Live resolver checks require the DNS Prober companion service"
            headingLevel="h3"
            icon={GlobeIcon}
          >
            <EmptyStateBody>
              The browser has no DNS API, so cross-resolver probing has to run cluster-side. The
              plugin&apos;s own repo ships a small Quarkus companion (<code>dns-prober/</code>) that
              answers <code>POST /api/probe</code>. Once installed, set{' '}
              <code>dnsProberUrl</code> on the <code>kuadrant-console-config</code> ConfigMap
              and this table starts showing live per-resolver results for hostname{' '}
              <code>{hostname || '(none)'}</code>.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  variant="secondary"
                  component="a"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://github.com/hodrigohamalho/kuadrant-console/tree/main/dns-prober"
                  icon={<ExternalLinkAltIcon />}
                  iconPosition="end"
                >
                  Installation docs
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  // Case 2: prober configured but errored / no rows — EmptyState with
  // the reason. We deliberately don't fall back to a synthesised view:
  // a fake table pretending to be real is worse UX than a clear "no
  // data" screen.
  if (prober.error || (!prober.loading && (!prober.resolvers || prober.resolvers.length === 0))) {
    return (
      <Card aria-label="DNS resolution preview">
        <CardTitle>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            DNS resolution preview
            <Tooltip content={prober.error || 'Prober returned no rows'}>
              <Label color={prober.error ? 'red' : 'grey'} isCompact>
                {prober.error ? 'Prober error' : 'No data'}
              </Label>
            </Tooltip>
          </span>
        </CardTitle>
        <CardBody>
          <EmptyState
            titleText={prober.error ? 'DNS Prober is unreachable' : 'No resolver data returned'}
            headingLevel="h3"
            icon={ExclamationCircleIcon}
          >
            <EmptyStateBody>
              {prober.error ? (
                <>
                  The plugin could not reach the DNS Prober companion service. Check that the
                  prober pod is healthy and that <code>dnsProberUrl</code> on the plugin
                  ConfigMap points at a working route.
                  <div style={{ marginTop: 8, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
                    {prober.error}
                  </div>
                </>
              ) : (
                <>
                  The prober responded but returned no rows for{' '}
                  <code>{hostname || '(none)'}</code>. This can happen right after a hostname
                  is added — retry once the record has been written at the provider.
                </>
              )}
            </EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  // Case 3: live rows.
  return (
    <Card aria-label="DNS resolution preview">
      <CardTitle>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          DNS resolution preview
          {prober.loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <Spinner size="sm" /> probing…
            </span>
          ) : (
            <Tooltip
              content={
                prober.probedAt
                  ? `Last probed ${new Date(prober.probedAt).toLocaleTimeString()}`
                  : 'Real cross-resolver checks from the DNS Prober companion service.'
              }
            >
              <Label color="green" isCompact>Live</Label>
            </Tooltip>
          )}
        </span>
      </CardTitle>
      <CardBody>
        <div className="rhcl-dns-resolver-body">
          <ResolverRows rows={prober.resolvers || []} />
          {/* Geo view — one dot per resolver at its HQ lat/lng, coloured
              by the returned answer. Same answer, same colour: an
              instant "which cluster did each resolver land on" read.
              Renders below the table on narrow viewports, side-by-side
              on wide ones (see rhcl-dns-resolver-body CSS). */}
          <DNSResolverMap resolvers={prober.resolvers || []} isMultiSite={isMultiSite} />
        </div>
      </CardBody>
    </Card>
  );
};

export default DNSResolverTable;
