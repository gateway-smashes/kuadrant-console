import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Button,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  OutlinedQuestionCircleIcon,
} from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { STATUS_META } from '../dns/types';
import { TlsCheck, TlsStepStatus } from './types';

/**
 * The Diagnostics table mirrors the DNS Diagnostics table — same rows-
 * with-icons layout, same status colours. Rows without a resource link
 * render the details cell plain; rows with one turn the details cell
 * into a link so a failed check jumps straight to what needs fixing.
 */

const StatusIcon: React.FC<{ status: TlsStepStatus }> = ({ status }) => {
  const style = { color: STATUS_META[status].color, fontSize: 14 };
  switch (STATUS_META[status].icon) {
    case 'check':
      return <CheckCircleIcon style={style} aria-hidden="true" />;
    case 'clock':
      return <ClockIcon style={style} aria-hidden="true" />;
    case 'exclamation':
      return <ExclamationTriangleIcon style={style} aria-hidden="true" />;
    case 'x':
      return <ExclamationCircleIcon style={style} aria-hidden="true" />;
    case 'minus':
      return <MinusCircleIcon style={style} aria-hidden="true" />;
    default:
      return <OutlinedQuestionCircleIcon style={style} aria-hidden="true" />;
  }
};

const StatusChip: React.FC<{ status: TlsStepStatus }> = ({ status }) => {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: meta.color,
        fontWeight: 500,
      }}
    >
      <StatusIcon status={status} /> {meta.label}
    </span>
  );
};

interface Props {
  checks: TlsCheck[];
  onRunAll?: () => void;
}

const TLSDiagnosticsTable: React.FC<Props> = ({ checks, onRunAll }) => (
  <Card aria-label="Diagnostics" className="rhcl-tls-panel">
    <CardTitle>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        Diagnostics Checks
        {onRunAll && (
          <Button variant="secondary" size="sm" onClick={onRunAll}>
            Run All Checks
          </Button>
        )}
      </span>
    </CardTitle>
    <CardBody>
      <Table aria-label="Diagnostics" variant="compact" borders={false}>
        <Thead>
          <Tr>
            <Th>Check</Th>
            <Th>Status</Th>
            <Th>Details</Th>
            <Th>Duration</Th>
          </Tr>
        </Thead>
        <Tbody>
          {checks.map((c) => (
            <Tr key={c.id}>
              <Td>{c.label}</Td>
              <Td>
                <StatusChip status={c.status} />
              </Td>
              <Td>
                {c.details ? (
                  c.href ? (
                    <Link to={c.href}>{c.details}</Link>
                  ) : (
                    <span
                      style={{
                        color:
                          c.status === 'failing'
                            ? STATUS_META.failing.color
                            : undefined,
                      }}
                    >
                      {c.details}
                    </span>
                  )
                ) : (
                  '—'
                )}
              </Td>
              <Td>
                {c.durationMs != null ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--pf-t--global--text--color--subtle)',
                    }}
                  >
                    {c.durationMs} ms
                  </span>
                ) : (
                  '—'
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </CardBody>
  </Card>
);

export default TLSDiagnosticsTable;
