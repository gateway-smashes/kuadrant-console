import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
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
  ExclamationTriangleIcon,
  ClockIcon,
  MinusCircleIcon,
  OutlinedQuestionCircleIcon,
} from '@patternfly/react-icons';
import { DnsCheck, STATUS_META } from './types';

/**
 * The 10-11 canonical DNS checks as a scannable table. Each row is
 * derived from the same flow snapshot the diagram uses, so a green
 * badge in a step here matches the check row's green tick — no drift.
 *
 * Sort is fixed: the order matches the natural request-path
 * progression, so the eye can walk top-to-bottom and stop at the first
 * ✗.
 */

interface Props {
  checks: DnsCheck[];
}

const CheckIcon: React.FC<{ status: DnsCheck['status'] }> = ({ status }) => {
  const style = { color: STATUS_META[status].color, fontSize: 14 };
  switch (status) {
    case 'healthy':
      return <CheckCircleIcon style={style} />;
    case 'failing':
      return <ExclamationCircleIcon style={style} />;
    case 'warning':
      return <ExclamationTriangleIcon style={style} />;
    case 'pending':
      return <ClockIcon style={style} />;
    case 'skipped':
    case 'not-configured':
      return <MinusCircleIcon style={style} />;
    default:
      return <OutlinedQuestionCircleIcon style={style} />;
  }
};

const DNSDiagnosticsTable: React.FC<Props> = ({ checks }) => (
  <Card aria-label="DNS checks">
    <CardTitle>DNS checks</CardTitle>
    <CardBody>
      <Table aria-label="DNS checks" variant="compact" borders={false}>
        <Thead>
          <Tr>
            <Th width={40}>Check</Th>
            <Th width={20}>Status</Th>
            <Th>Details</Th>
          </Tr>
        </Thead>
        <Tbody>
          {checks.map((c) => (
            <Tr key={c.id}>
              <Td>{c.label}</Td>
              <Td>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: STATUS_META[c.status].color }}>
                  <CheckIcon status={c.status} />
                  {STATUS_META[c.status].label}
                </span>
              </Td>
              <Td>
                <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {c.details || '—'}
                </span>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </CardBody>
  </Card>
);

export default DNSDiagnosticsTable;
