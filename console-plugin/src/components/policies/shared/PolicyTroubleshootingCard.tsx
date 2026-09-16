import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
  List,
  ListItem,
} from '@patternfly/react-core';
import { ExclamationTriangleIcon, ArrowRightIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PolicyStatusSummary, policyTroubleshootingHints } from './state';
import { PolicyResource } from './types';
import { PolicyTargetReference } from '../../../types/common';

interface Props {
  policy: PolicyResource;
  summary: PolicyStatusSummary;
  targetRef?: PolicyTargetReference;
}

/**
 * Troubleshooting card — surfaces actionable diagnostics when the policy
 * isn't healthy. Stays out of the way otherwise. Combines pattern-matched
 * hints (`policyTroubleshootingHints`) with one-click links to the most
 * common follow-up actions.
 */
export const PolicyTroubleshootingCard: React.FC<Props> = ({
  policy,
  summary,
  targetRef,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const hints = policyTroubleshootingHints(policy, summary);
  if (summary.state === 'healthy' || hints.length === 0) return null;

  const targetNs = targetRef?.namespace || policy.metadata?.namespace || '';
  const openTargetHref =
    targetRef?.kind === 'Gateway'
      ? `/connectivity-link/gateways/${targetNs}/${targetRef.name}`
      : targetRef?.kind === 'HTTPRoute'
      ? `/connectivity-link/httproutes/${targetNs}/${targetRef.name}`
      : null;

  return (
    <Card>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          spaceItems={{ default: 'spaceItemsSm' }}
        >
          <FlexItem>
            <ExclamationTriangleIcon color="var(--pf-t--global--color--status--warning--default)" />
          </FlexItem>
          <FlexItem>{t('Troubleshooting')}</FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
          <FlexItem>
            <div
              style={{
                fontSize: 13,
                color: 'var(--pf-t--global--text--color--subtle)',
                marginBottom: 8,
              }}
            >
              {t('Possible reasons')}
            </div>
            <List isPlain isBordered>
              {hints.map((h) => (
                <ListItem key={h.id}>
                  <strong>{t(h.label)}</strong>
                  {h.detail && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--pf-t--global--text--color--subtle)',
                        marginTop: 2,
                      }}
                    >
                      {h.detail}
                    </div>
                  )}
                </ListItem>
              ))}
            </List>
          </FlexItem>
          <FlexItem>
            <div
              style={{
                fontSize: 13,
                color: 'var(--pf-t--global--text--color--subtle)',
                marginBottom: 4,
              }}
            >
              {t('Recommended actions')}
            </div>
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              {openTargetHref && (
                <FlexItem>
                  <Button
                    variant="link"
                    component={(props) => <Link {...props} to={openTargetHref} />}
                    isInline
                    icon={<ArrowRightIcon />}
                    iconPosition="right"
                  >
                    {targetRef?.kind === 'Gateway' ? t('Open Gateway') : t('Open HTTPRoute')}
                  </Button>
                </FlexItem>
              )}
              <FlexItem>
                <Button
                  variant="link"
                  component={(props) => <Link {...props} to="/connectivity-link/policies" />}
                  isInline
                >
                  {t('View other policies')}
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

export default PolicyTroubleshootingCard;
