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
import { STATUS_META } from '../dns/types';
import {
  TlsCertRow,
  CertHealthStatus,
  RenewalStatus,
  HandshakeStatus,
} from './useTlsOverview';
import { TlsOverviewFilters } from './useTlsOverviewFilters';

interface Props {
  rows: TlsCertRow[];
  filterOptions: {
    gateways: string[];
    issuers: string[];
    namespaces: string[];
  };
  filters: TlsOverviewFilters;
  onFilterChange: <K extends keyof TlsOverviewFilters>(
    key: K,
    value: TlsOverviewFilters[K],
  ) => void;
  onClearAll: () => void;
  onRerun?: (row: TlsCertRow) => void;
}

const STATUS_LABEL: Record<CertHealthStatus, string> = {
  healthy: 'Healthy',
  expiring: 'Expiring Soon',
  expired: 'Expired',
  error: 'Error',
};
const STATUS_COLOR: Record<CertHealthStatus, 'green' | 'orange' | 'red' | 'grey'> = {
  healthy: 'green',
  expiring: 'orange',
  expired: 'red',
  error: 'grey',
};
const STATUS_ICON: Record<CertHealthStatus, React.ReactNode> = {
  healthy: <CheckCircleIcon style={{ color: STATUS_META.healthy.color }} />,
  expiring: <ExclamationTriangleIcon style={{ color: STATUS_META.warning.color }} />,
  expired: <ExclamationCircleIcon style={{ color: STATUS_META.failing.color }} />,
  error: <OutlinedQuestionCircleIcon style={{ color: STATUS_META.unknown.color }} />,
};
const RENEWAL_META: Record<RenewalStatus, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: STATUS_META.healthy.color },
  'not-scheduled': { label: 'Not Scheduled', color: STATUS_META.warning.color },
  failed: { label: 'Failed', color: STATUS_META.failing.color },
  unknown: { label: 'Unknown', color: STATUS_META.unknown.color },
};
const HANDSHAKE_META: Record<HandshakeStatus, { label: string; color: string }> = {
  ok: { label: 'OK', color: STATUS_META.healthy.color },
  failed: { label: 'Failed', color: STATUS_META.failing.color },
  unknown: { label: 'Unknown', color: STATUS_META.unknown.color },
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

interface RowActionsProps {
  row: TlsCertRow;
  onRerun?: (row: TlsCertRow) => void;
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
          Open TLS Troubleshooting
        </DropdownItem>
        <DropdownItem
          key="cert"
          component={(props) => <Link {...props} to={row.href.certificate} />}
        >
          Open Certificate
        </DropdownItem>
        {row.href.gateway && (
          <DropdownItem
            key="gateway"
            component={(props) => <Link {...props} to={row.href.gateway!} />}
          >
            Open Gateway
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
          description={!onRerun ? 'Requires the tls-prober endpoint' : undefined}
        >
          Re-run HTTPS check
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};

const TLSOverviewTable: React.FC<Props> = ({
  rows,
  filterOptions,
  filters,
  onFilterChange,
  onClearAll,
  onRerun,
}) => {
  const { search, gateway, issuer, status, namespace } = filters;

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay =
          `${r.hostname} ${r.certificateName} ${r.gatewayName || ''} ${r.issuerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (gateway && r.gatewayName !== gateway) return false;
      if (issuer && r.issuerLabel !== issuer) return false;
      if (status && r.status !== status) return false;
      if (namespace && r.namespace !== namespace) return false;
      return true;
    });
  }, [rows, search, gateway, issuer, status, namespace]);

  const totalLabel = `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''}`;
  const hasActiveFilter = !!(search || gateway || issuer || status || namespace);

  return (
    <Card aria-label="TLS certificates" className="rhcl-tls-overview-panel">
      <CardTitle>TLS Certificates ({totalLabel})</CardTitle>
      <CardBody>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem style={{ minWidth: 260 }}>
              <SearchInput
                placeholder="Search hostnames, certificates, gateways…"
                value={search}
                onChange={(_e, v) => onFilterChange('search', v)}
                onClear={() => onFilterChange('search', '')}
                aria-label="Search"
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect label="Gateway" value={gateway} options={filterOptions.gateways} onChange={(v) => onFilterChange('gateway', v)} />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect label="Issuer" value={issuer} options={filterOptions.issuers} onChange={(v) => onFilterChange('issuer', v)} />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect
                label="Status"
                value={status}
                options={['healthy', 'expiring', 'expired', 'error']}
                onChange={(v) => onFilterChange('status', v)}
              />
            </ToolbarItem>
            <ToolbarItem>
              <FilterSelect label="Namespace" value={namespace} options={filterOptions.namespaces} onChange={(v) => onFilterChange('namespace', v)} />
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
            titleText={rows.length === 0 ? 'No TLS certificates detected' : 'Nothing matches your filters'}
            headingLevel="h4"
            icon={SearchIcon}
          >
            <EmptyStateBody>
              {rows.length === 0
                ? 'Create a TLSPolicy to publish certificates for a Gateway. Once cert-manager finishes issuing, they will show up here automatically.'
                : 'Clear a filter or the search query to see more rows.'}
            </EmptyStateBody>
            {rows.length === 0 ? (
              <Button
                variant="primary"
                component={(props) => <Link {...props} to="/connectivity-link/policies/create/tlspolicy" />}
                style={{ marginTop: 12 }}
              >
                Create TLSPolicy
              </Button>
            ) : (
              <Button variant="link" onClick={onClearAll} style={{ marginTop: 12 }}>
                Clear all filters
              </Button>
            )}
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table aria-label="TLS certificates" variant="compact" borders={false}>
              <Thead>
                <Tr>
                  <Th>Hostname</Th>
                  <Th>Gateway</Th>
                  <Th>Certificate</Th>
                  <Th>Issuer</Th>
                  <Th>Status</Th>
                  <Th>Valid Until</Th>
                  <Th>Days Left</Th>
                  <Th>Auto Renewal</Th>
                  <Th>Handshake</Th>
                  <Th aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((r) => {
                  const daysColor =
                    r.daysRemaining == null ? undefined
                    : r.daysRemaining < 0 ? '#C9190B'
                    : r.daysRemaining < 7 ? '#C9190B'
                    : r.daysRemaining < 30 ? '#F0AB00'
                    : '#3E8635';
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link to={r.href.troubleshooting} className="rhcl-tls-overview-hostname">
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
                      <Td>{r.certificateName}</Td>
                      <Td>
                        <Tooltip content={r.issuerName || r.issuerLabel}>
                          <span>{r.issuerLabel}</span>
                        </Tooltip>
                      </Td>
                      <Td>
                        <Label color={STATUS_COLOR[r.status]} icon={STATUS_ICON[r.status]} isCompact>
                          {STATUS_LABEL[r.status]}
                        </Label>
                      </Td>
                      <Td>
                        {r.validUntil
                          ? new Date(r.validUntil).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </Td>
                      <Td style={{ color: daysColor, fontWeight: 500 }}>
                        {r.daysRemaining == null ? '—'
                          : r.daysRemaining < 0 ? `-${Math.abs(r.daysRemaining)} days`
                          : `${r.daysRemaining} days`}
                      </Td>
                      <Td>
                        <span
                          style={{
                            display: 'inline-flex',
                            gap: 4,
                            alignItems: 'center',
                            color: RENEWAL_META[r.renewal].color,
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: RENEWAL_META[r.renewal].color,
                            }}
                          />
                          {RENEWAL_META[r.renewal].label}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: HANDSHAKE_META[r.handshake].color }}>
                          {HANDSHAKE_META[r.handshake].label}
                        </span>
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

export default TLSOverviewTable;
