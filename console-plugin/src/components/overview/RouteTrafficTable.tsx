import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Sparkline from './Sparkline';
import { RouteTrafficRow } from './types';
import { OVERVIEW_LIST_LIMIT, ListCardFooter, rankByError } from './overviewList';

interface Props {
  rows: RouteTrafficRow[];
}

/**
 * HTTPRoutes with operational signals: requests/min, error rate,
 * attached policy count, mini traffic trend.
 */
export const RouteTrafficTable: React.FC<Props> = ({ rows }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const visible = React.useMemo(
    () => rankByError(rows).slice(0, OVERVIEW_LIST_LIMIT),
    [rows],
  );
  return (
    <Card aria-label={t('HTTPRoutes traffic')}>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>{t('HTTPRoutes')}</FlexItem>
          <FlexItem>
            <Button
              variant="link"
              isInline
              component={(props) => <Link {...props} to="/connectivity-link/httproutes" />}
            >
              {t('View all')}
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Table variant="compact" borders={false} aria-label={t('HTTPRoute traffic')}>
          <Thead>
            <Tr>
              <Th>{t('Route')}</Th>
              <Th>{t('Namespace')}</Th>
              <Th>{t('Gateway')}</Th>
              <Th>{t('Requests / min')}</Th>
              <Th>{t('Trend')}</Th>
              <Th>{t('Error Rate')}</Th>
              <Th>{t('Policies')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {visible.map((r) => {
              const errorTone = r.errorRatePct >= 5 ? 'bad' : r.errorRatePct >= 1 ? 'warn' : 'good';
              const errorColor =
                errorTone === 'bad' ? 'var(--pf-t--global--color--status--danger--default)' :
                errorTone === 'warn' ? 'var(--pf-t--global--color--status--warning--default)' :
                'var(--pf-t--global--color--status--success--default)';
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link to={r.href}>{r.name}</Link>
                  </Td>
                  <Td>{r.namespace}</Td>
                  <Td>{r.gatewayName}</Td>
                  <Td>{r.requestsPerMin.toLocaleString('en-US')}</Td>
                  <Td>
                    <div style={{ color: 'var(--pf-t--global--color--status--info--default)', width: 90 }}>
                      <Sparkline data={r.sparkline} width={90} height={28} strokeWidth={1.25} responsive={false} />
                    </div>
                  </Td>
                  <Td>
                    <span style={{ color: errorColor, fontWeight: 500 }}>
                      {r.errorRatePct}%
                    </span>
                  </Td>
                  <Td>{r.policiesCount}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        <ListCardFooter shown={visible.length} total={rows.length} />
      </CardBody>
    </Card>
  );
};

export default RouteTrafficTable;
