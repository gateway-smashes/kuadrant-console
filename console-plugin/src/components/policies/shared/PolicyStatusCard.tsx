import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Label,
  Alert,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { PolicyStatusSummary } from './state';

interface Props {
  summary: PolicyStatusSummary;
}

function isoToHuman(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const STATE_LABEL: Record<PolicyStatusSummary['state'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  progressing: 'Progressing',
  unknown: 'Unknown',
};

const STATE_COLOR: Record<PolicyStatusSummary['state'], 'green' | 'orange' | 'blue' | 'grey'> = {
  healthy: 'green',
  degraded: 'orange',
  progressing: 'blue',
  unknown: 'grey',
};

/**
 * Operational status card — the "is this thing actually working?"
 * answer. Always present on the operational page, regardless of kind.
 * When the policy is degraded, mounts an inline Alert with the
 * controller-provided reason so the operator doesn't have to expand the
 * troubleshooting card to learn why.
 */
export const PolicyStatusCard: React.FC<Props> = ({ summary }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  return (
    <Card>
      <CardTitle>{t('Operational Status')}</CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
          <FlexItem>
            <Flex
              spaceItems={{ default: 'spaceItemsMd' }}
              alignItems={{ default: 'alignItemsCenter' }}
            >
              <FlexItem>
                <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Current status')}
                </span>
                <div>
                  <Label color={STATE_COLOR[summary.state]}>
                    {t(STATE_LABEL[summary.state])}
                  </Label>
                </div>
              </FlexItem>
              <FlexItem>
                <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Accepted')}
                </span>
                <div>
                  <Label
                    color={summary.accepted ? 'green' : 'grey'}
                    variant={summary.accepted ? 'filled' : 'outline'}
                  >
                    {summary.accepted ? t('True') : t('False')}
                  </Label>
                </div>
              </FlexItem>
              <FlexItem>
                <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {t('Enforced')}
                </span>
                <div>
                  <Label
                    color={summary.enforced ? 'green' : 'grey'}
                    variant={summary.enforced ? 'filled' : 'outline'}
                  >
                    {summary.enforced ? t('True') : t('False')}
                  </Label>
                </div>
              </FlexItem>
            </Flex>
          </FlexItem>
          {summary.reason && (
            <FlexItem>
              <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                {t('Reason')}
              </span>
              <div style={{ fontSize: 14 }}>{summary.reason}</div>
            </FlexItem>
          )}
          {summary.lastTransitionTime && (
            <FlexItem>
              <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                {t('Last transition')}
              </span>
              <div style={{ fontSize: 14 }}>
                {isoToHuman(summary.lastTransitionTime)}
              </div>
            </FlexItem>
          )}
          {summary.state === 'degraded' && summary.message && (
            <FlexItem>
              <Alert variant="warning" isInline isPlain title={t('Why is this degraded?')}>
                {summary.message}
              </Alert>
            </FlexItem>
          )}
        </Flex>
      </CardBody>
    </Card>
  );
};

export default PolicyStatusCard;
