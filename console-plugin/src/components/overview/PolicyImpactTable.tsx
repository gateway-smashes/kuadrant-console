import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
  Label,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PolicyImpact, PolicyImpactRow } from './types';
import { OVERVIEW_LIST_LIMIT, ListCardFooter, rankByPolicyStatus } from './overviewList';

// Turns the discriminated PolicyImpact into the label rendered in the
// "Impact" column, using i18n templates so cluster-derived strings
// (target kind/name) go through {{placeholders}} instead of being
// looked up as literal keys — see the hook's docstring for context.
function useImpactLabel(): (impact: PolicyImpact) => string {
  const { t } = useTranslation('plugin__kuadrant-console');
  return (impact) => {
    switch (impact.kind) {
      case 'targeting':
        return t('Targeting {{kind}}/{{name}}', {
          kind: impact.targetKind,
          name: impact.targetName,
        });
      case 'accepted':
        return t('Accepted, no enforcement');
      case 'overridden':
        return t('Overridden by route policy');
      case 'not-accepted':
        return t('Not accepted');
      case 'no-target':
        return t('No target attached');
    }
  };
}

interface Props {
  rows: PolicyImpactRow[];
}

const STATUS_COLOR: Record<PolicyImpactRow['status'], 'green' | 'blue' | 'purple' | 'red' | 'grey'> = {
  enforced: 'green',
  accepted: 'blue',
  overridden: 'purple',
  failed: 'red',
};

/**
 * Policies viewed through an operational lens — what is each policy
 * actually doing? Status is condensed to 4 outcomes; impact column tells
 * the story ("Protecting 1 route", "Not attached", "Overridden by route").
 */
export const PolicyImpactTable: React.FC<Props> = ({ rows }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const impactLabel = useImpactLabel();
  const statusLabel: Record<PolicyImpactRow['status'], string> = {
    enforced: t('Enforced'),
    accepted: t('Accepted'),
    overridden: t('Overridden'),
    failed: t('Failed'),
  };
  const visible = React.useMemo(
    () => rankByPolicyStatus(rows).slice(0, OVERVIEW_LIST_LIMIT),
    [rows],
  );
  return (
    <Card aria-label={t('Policies and their effective impact')}>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>{t('Policies')}</FlexItem>
          <FlexItem>
            <Button
              variant="link"
              isInline
              component={(props) => <Link {...props} to="/connectivity-link/policies" />}
            >
              {t('View all')}
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Table variant="compact" borders={false} aria-label={t('Policy impact')}>
          <Thead>
            <Tr>
              <Th>{t('Policy')}</Th>
              <Th>{t('Namespace')}</Th>
              <Th>{t('Type')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Effect')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {visible.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link to={r.href}>{r.name}</Link>
                </Td>
                <Td>{r.namespace}</Td>
                <Td>{t(r.typeLabel)}</Td>
                <Td>
                  <Label
                    isCompact
                    color={STATUS_COLOR[r.status]}
                    variant="outline"
                  >
                    {statusLabel[r.status]}
                  </Label>
                </Td>
                <Td>
                  <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 13 }}>
                    {impactLabel(r.impact)}
                  </span>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        <ListCardFooter shown={visible.length} total={rows.length} />
      </CardBody>
    </Card>
  );
};

export default PolicyImpactTable;
