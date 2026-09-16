import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  MenuToggleElement,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Label,
  Tooltip,
  EmptyState,
  EmptyStateBody,
  Button,
  Progress,
  ProgressSize,
  Dropdown,
  DropdownList,
  DropdownItem,
  Divider,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  OutlinedQuestionCircleIcon,
  EllipsisVIcon,
  SearchIcon,
} from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { STATUS_META } from './types';
import {
  DnsRecordRow,
  DnsHealthStatus,
} from './useDnsOverview';
import { DnsOverviewFilters } from './useDnsOverviewFilters';

/**
 * Controlled version of the DNS Records table. Filter state lives one
 * level up (`useDnsOverviewFilters` in the page), so KPI card clicks,
 * histogram bar clicks, and donut slice clicks can all mutate it, and
 * the URL query string carries the current scope for bookmark + back-
 * button behaviour.
 */

interface Props {
  rows: DnsRecordRow[];
  filterOptions: {
    gateways: string[];
    providers: string[];
    namespaces: string[];
    recordTypes: string[];
  };
  filters: DnsOverviewFilters;
  onFilterChange: <K extends keyof DnsOverviewFilters>(
    key: K,
    value: DnsOverviewFilters[K],
  ) => void;
  onClearAll: () => void;
  /** Called when the user clicks "Re-run checks" on a row. Optional; if
   *  omitted the item is disabled with a tooltip. */
  onRerun?: (row: DnsRecordRow) => void;
}

const STATUS_LABEL: Record<DnsHealthStatus, string> = {
  healthy: 'Healthy',
  propagating: 'Propagating',
  failed: 'Failed',
  unknown: 'Unknown',
};
const STATUS_COLOR: Record<DnsHealthStatus, 'green' | 'orange' | 'red' | 'grey'> = {
  healthy: 'green',
  propagating: 'orange',
  failed: 'red',
  unknown: 'grey',
};
const STATUS_ICON: Record<DnsHealthStatus, React.ReactNode> = {
  healthy: <CheckCircleIcon style={{ color: STATUS_META.healthy.color }} />,
  propagating: <ExclamationTriangleIcon style={{ color: STATUS_META.warning.color }} />,
  failed: <ExclamationCircleIcon style={{ color: STATUS_META.failing.color }} />,
  unknown: <OutlinedQuestionCircleIcon style={{ color: STATUS_META.unknown.color }} />,
};

const FilterSelect: React.FC<{
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}> = ({ label, value, options, onChange }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  return (
    <Select
      aria-label={label}
      isOpen={isOpen}
      selected={value ?? '__all__'}
      onOpenChange={setIsOpen}
      onSelect={(_e, v) => {
        setIsOpen(false);
        onChange(v === '__all__' || v == null ? null : String(v));
      }}
      toggle={(ref: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={ref}
          onClick={() => setIsOpen((o) => !o)}
          isExpanded={isOpen}
          style={{ minWidth: 160 }}
        >
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', marginRight: 6 }}>
            {label}:
          </span>
          {value ?? 'All'}
        </MenuToggle>
      )}
    >
      <SelectList>
        <SelectOption value="__all__">
          <span style={{ fontStyle: 'italic' }}>All {label.toLowerCase()}s</span>
        </SelectOption>
        {options.map((o) => (
          <SelectOption key={o} value={o}>
            {o}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
};

// --- Row kebab menu -------------------------------------------------

interface RowActionsProps {
  row: DnsRecordRow;
  onRerun?: (row: DnsRecordRow) => void;
}

const RowActions: React.FC<RowActionsProps> = ({ row, onRerun }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onSelect={() => setIsOpen(false)}
      popperProps={{ position: 'right' }}
      toggle={(ref: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={ref}
          variant="plain"
          aria-label={`Actions for ${row.hostname}`}
          onClick={() => setIsOpen((o) => !o)}
          isExpanded={isOpen}
        >
          <EllipsisVIcon />
        </MenuToggle>
      )}
    >
      <DropdownList>
        <DropdownItem
          key="tshoot"
          component={(props) => <Link {...props} to={row.href.troubleshooting} />}
        >
          Open DNS Troubleshooting
        </DropdownItem>
        {row.href.dnsPolicy && (
          <DropdownItem
            key="policy"
            component={(props) => <Link {...props} to={row.href.dnsPolicy!} />}
          >
            Open DNSPolicy
          </DropdownItem>
        )}
        {row.href.gateway && (
          <DropdownItem
            key="gateway"
            component={(props) => <Link {...props} to={row.href.gateway!} />}
          >
            Open Gateway
          </DropdownItem>
        )}
        {row.href.gateway && (
          <DropdownItem
            key="routes"
            component={(props) => (
              <Link
                {...props}
                to={`/k8s/all-namespaces/gateway.networking.k8s.io~v1~HTTPRoute?parentRef=${encodeURIComponent(row.gatewayName || '')}`}
              />
            )}
          >
            View related HTTPRoutes
          </DropdownItem>
        )}
        <Divider component="li" key="d1" />
        <DropdownItem
          key="events"
          component={(props) => <Link {...props} to={row.href.events} />}
        >
          View events
        </DropdownItem>
        <DropdownItem
          key="yaml"
          component={(props) => <Link {...props} to={row.href.yaml} />}
        >
          View YAML
        </DropdownItem>
        <Divider component="li" key="d2" />
        <DropdownItem
          key="rerun"
          isDisabled={!onRerun}
          onClick={() => onRerun && onRerun(row)}
          description={!onRerun ? 'Requires dns-prober companion' : undefined}
        >
          Re-run resolver checks
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};

// --- helpers --------------------------------------------------------

function relAgo(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// --- Table ----------------------------------------------------------

const DNSOverviewTable: React.FC<Props> = ({
  rows,
  filterOptions,
  filters,
  onFilterChange,
  onClearAll,
  onRerun,
}) => {
  const { search, gateway, provider, status, namespace, recordType } = filters;

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.hostname} ${r.recordName} ${r.gatewayName || ''} ${r.providerLabel} ${r.target}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (gateway && r.gatewayName !== gateway) return false;
      if (provider && r.providerLabel !== provider) return false;
      if (status && r.status !== status) return false;
      if (namespace && r.namespace !== namespace) return false;
      if (recordType && r.recordType !== recordType) return false;
      return true;
    });
  }, [rows, search, gateway, provider, status, namespace, recordType]);

  const totalLabel = `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''}`;
  const hasActiveFilter = !!(search || gateway || provider || status || namespace || recordType);

  return (
    <Card aria-label="DNS records" className="rhcl-dns-overview-panel">
      <CardTitle>DNS Records ({totalLabel})</CardTitle>
      <CardBody>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem style={{ minWidth: 260 }}>
              <SearchInput
                placeholder="Search hostnames, records, gateways…"
                value={search}
                onChange={(_e, v) => onFilterChange('search', v)}
                onClear={() => onFilterChange('search', '')}
                aria-label="Search"
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Gateway"
                value={gateway}
                options={filterOptions.gateways}
                onChange={(v) => onFilterChange('gateway', v)}
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Provider"
                value={provider}
                options={filterOptions.providers}
                onChange={(v) => onFilterChange('provider', v)}
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Status"
                value={status}
                options={['healthy', 'propagating', 'failed', 'unknown']}
                onChange={(v) => onFilterChange('status', v)}
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Type"
                value={recordType}
                options={filterOptions.recordTypes}
                onChange={(v) => onFilterChange('recordType', v)}
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Namespace"
                value={namespace}
                options={filterOptions.namespaces}
                onChange={(v) => onFilterChange('namespace', v)}
              />
            </ToolbarItem>
            {hasActiveFilter && (
              <ToolbarItem>
                <Button variant="link" isInline onClick={onClearAll}>
                  Clear all filters
                </Button>
              </ToolbarItem>
            )}
          </ToolbarContent>
        </Toolbar>

        {filtered.length === 0 ? (
          <EmptyState
            titleText={rows.length === 0 ? 'No DNS records detected' : 'Nothing matches your filters'}
            headingLevel="h4"
            icon={SearchIcon}
          >
            <EmptyStateBody>
              {rows.length === 0
                ? 'Create a DNSPolicy to publish DNS records for a Gateway. Once Kuadrant reconciles, records will show up here automatically.'
                : 'Clear a filter or the search query to see more rows.'}
            </EmptyStateBody>
            {rows.length === 0 ? (
              <Button
                variant="primary"
                component={(props) => <Link {...props} to="/connectivity-link/policies/create/dnspolicy" />}
                style={{ marginTop: 12 }}
              >
                Create DNSPolicy
              </Button>
            ) : (
              <Button variant="link" onClick={onClearAll} style={{ marginTop: 12 }}>
                Clear all filters
              </Button>
            )}
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table aria-label="DNS records" variant="compact" borders={false}>
              <Thead>
                <Tr>
                  <Th>Hostname</Th>
                  <Th>Gateway</Th>
                  <Th>Type</Th>
                  <Th>Target</Th>
                  <Th>DNS Provider</Th>
                  <Th>Status</Th>
                  <Th>Propagation</Th>
                  <Th>Public Resolution</Th>
                  <Th>Last Checked</Th>
                  <Th aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((r) => {
                  const propColor =
                    r.propagationPct >= 90 ? '#3E8635'
                    : r.propagationPct >= 40 ? '#F0AB00'
                    : '#C9190B';
                  const resColor =
                    r.resolutionPct >= 90 ? '#3E8635'
                    : r.resolutionPct >= 40 ? '#F0AB00'
                    : '#C9190B';
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link to={r.href.troubleshooting} className="rhcl-dns-overview-hostname">
                          {r.hostname}
                        </Link>
                      </Td>
                      <Td>
                        {r.gatewayName && r.href.gateway ? (
                          <Link to={r.href.gateway}>{r.gatewayName}</Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{r.recordType}</Td>
                      <Td>
                        <Tooltip content={r.targets.join(', ') || r.target}>
                          <code style={{ fontSize: 12 }}>{r.target}</code>
                        </Tooltip>
                      </Td>
                      <Td>{r.providerLabel}</Td>
                      <Td>
                        <Label color={STATUS_COLOR[r.status]} icon={STATUS_ICON[r.status]} isCompact>
                          {STATUS_LABEL[r.status]}
                        </Label>
                      </Td>
                      <Td style={{ minWidth: 140 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ minWidth: 40, textAlign: 'right', fontSize: 12, fontWeight: 500 }}>
                            {r.propagationPct}%
                          </span>
                          <span style={{ flex: 1 }}>
                            <Progress
                              value={r.propagationPct}
                              size={ProgressSize.sm}
                              aria-label={`Propagation ${r.propagationPct}%`}
                              measureLocation={"none" as never}
                              style={{ ['--pf-v6-c-progress__indicator--BackgroundColor' as never]: propColor }}
                            />
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          {r.resolution === 'resolved' ? (
                            <CheckCircleIcon style={{ color: resColor }} />
                          ) : r.resolution === 'unresolved' ? (
                            <ExclamationCircleIcon style={{ color: resColor }} />
                          ) : (
                            <OutlinedQuestionCircleIcon style={{ color: resColor }} />
                          )}
                          <span style={{ color: resColor, fontWeight: 500 }}>
                            {r.resolution === 'unknown' ? 'Not checked' : `${r.resolutionPct}%`}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <Tooltip content={r.lastCheckedIso ? new Date(r.lastCheckedIso).toLocaleString() : 'never'}>
                          <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                            {relAgo(r.lastCheckedIso)}
                          </span>
                        </Tooltip>
                      </Td>
                      <Td style={{ width: 40 }}>
                        <RowActions row={r} onRerun={onRerun} />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default DNSOverviewTable;
