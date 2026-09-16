import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  Label,
  Tooltip,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import { HTTPRoute } from '../../../types';
import { HTTPROUTE_RISKY_PATHS } from './useHTTPRouteSecurityPosture';

interface Props {
  route: HTTPRoute;
}

/**
 * Backend refs table. Same information the old page rendered but with two
 * additions:
 *   - Weight column (defaulted to 1 when unset per Gateway API semantics)
 *   - Risky-path highlight: any path pattern in the fixed risky list is
 *     shown with an amber warning chip. Never automatically classified as
 *     insecure — the checks table is where the actual pass/warn/fail
 *     decision lands.
 */
export const BackendRefsCard: React.FC<Props> = ({ route }) => {
  const ns = route.metadata?.namespace || '';
  const rows: {
    key: string;
    ruleIdx: number;
    method: string;
    path: string;
    isRisky: boolean;
    backendName: string;
    backendNs: string;
    port: string;
    weight: number;
  }[] = [];
  (route.spec?.rules || []).forEach((rule, ri) => {
    const method = rule.matches?.[0]?.method || '*';
    const path = rule.matches?.[0]?.path?.value || '/';
    const isRisky = HTTPROUTE_RISKY_PATHS.some((p) =>
      p === '/' ? path === '/' : path === p || path.startsWith(p),
    );
    (rule.backendRefs || []).forEach((b, bi) => {
      rows.push({
        key: `${ri}-${bi}`,
        ruleIdx: ri,
        method,
        path,
        isRisky,
        backendName: b.name,
        backendNs: b.namespace || ns,
        port: b.port ? String(b.port) : '-',
        weight: b.weight ?? 1,
      });
    });
    // Rule with no backendRefs — still list it so the operator sees the
    // route matches something but resolves to nothing.
    if (!(rule.backendRefs || []).length) {
      rows.push({
        key: `${ri}-none`,
        ruleIdx: ri,
        method,
        path,
        isRisky,
        backendName: '-',
        backendNs: '',
        port: '-',
        weight: 0,
      });
    }
  });

  return (
    <Card>
      <CardTitle>Backend References</CardTitle>
      <CardBody>
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
            This HTTPRoute defines no rules.
          </div>
        ) : (
          // The Details tab's left column can be as narrow as ~380px at
          // xl=5 on a 1440-wide screen. Wrap in an overflow-x container so
          // the column header text never truncates ("Meth…", "Wei…").
          <div style={{ overflowX: 'auto' }}>
          <Table aria-label="Backend refs" variant="compact">
            <Thead>
              <Tr>
                <Th width={10}>Rule</Th>
                <Th width={15}>Method</Th>
                <Th>Path Pattern</Th>
                <Th>Backend</Th>
                <Th width={10}>Port</Th>
                <Th width={10}>Weight</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.key}>
                  <Td>{r.ruleIdx}</Td>
                  <Td>{r.method}</Td>
                  <Td>
                    <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }}>
                      <FlexItem>
                        <Tooltip content={r.path}>
                          <code
                            style={{
                              maxWidth: 240,
                              display: 'inline-block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'middle',
                            }}
                          >
                            {r.path}
                          </code>
                        </Tooltip>
                      </FlexItem>
                      {r.isRisky && (
                        <FlexItem>
                          <Tooltip content="This path matches a sensitive prefix (admin / debug / actuator / metrics / health / root). Confirm additional protection.">
                            <Label color="orange" isCompact icon={<ExclamationTriangleIcon />}>
                              risky
                            </Label>
                          </Tooltip>
                        </FlexItem>
                      )}
                    </Flex>
                  </Td>
                  <Td>
                    {r.backendName !== '-' ? (
                      <Link
                        to={`/k8s/ns/${r.backendNs}/services/${r.backendName}`}
                      >
                        {r.backendName}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </Td>
                  <Td>{r.port}</Td>
                  <Td>{r.weight}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
