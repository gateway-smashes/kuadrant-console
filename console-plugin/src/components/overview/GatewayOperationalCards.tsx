import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  AngleRightIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { GatewayOpData } from './types';

interface Props {
  gateways: GatewayOpData[];
}

const HealthBadge: React.FC<{ health: GatewayOpData['health'] }> = ({ health }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const map = {
    healthy: { color: 'var(--pf-t--global--color--status--success--default)', label: t('Healthy'), icon: <CheckCircleIcon aria-hidden="true" /> },
    warning: { color: 'var(--pf-t--global--color--status--warning--default)', label: t('Warning'), icon: <ExclamationTriangleIcon aria-hidden="true" /> },
    critical: { color: 'var(--pf-t--global--color--status--danger--default)', label: t('Degraded'), icon: <ExclamationCircleIcon aria-hidden="true" /> },
    info: { color: 'var(--pf-t--global--color--status--info--default)', label: t('Info'), icon: <CheckCircleIcon aria-hidden="true" /> },
    accepted: { color: 'var(--pf-t--global--color--status--info--default)', label: t('Accepted'), icon: <CheckCircleIcon aria-hidden="true" /> },
  };
  const { color, label, icon } = map[health];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontSize: 12, fontWeight: 500 }}>
      {icon}
      {label}
    </span>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }> = ({
  label, value, tone = 'neutral',
}) => {
  const color =
    tone === 'good' ? 'var(--pf-t--global--color--status--success--default)' :
    tone === 'bad' ? 'var(--pf-t--global--color--status--danger--default)' :
    'var(--pf-t--global--text--color--regular)';
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: 'var(--pf-t--global--text--color--subtle)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
};

/**
 * Gateway operational cards — one per gateway, each showing health badge,
 * traffic, success/error rates, route/policy counts. Cards stack inside a
 * single titled section card with a "View all" link.
 */
export const GatewayOperationalCards: React.FC<Props> = ({ gateways }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  return (
    <Card aria-label={t('Gateways')}>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>{t('Gateways')}</FlexItem>
          <FlexItem>
            <Button
              variant="link"
              isInline
              component={(props) => <Link {...props} to="/connectivity-link/gateways" />}
            >
              {t('View all')}
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
          {gateways.map((gw) => {
            const errorIsBad = gw.errorRatePct >= 5;
            return (
              <FlexItem key={gw.id}>
                <Link to={gw.href} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      border: '1px solid var(--pf-t--global--border--color--default)',
                    }}
                  >
                    <Flex
                      alignItems={{ default: 'alignItemsCenter' }}
                      justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    >
                      <FlexItem>
                        <Flex
                          alignItems={{ default: 'alignItemsCenter' }}
                          spaceItems={{ default: 'spaceItemsSm' }}
                        >
                          <FlexItem>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pf-t--global--text--color--regular)' }}>
                              {gw.name}
                            </div>
                          </FlexItem>
                          <FlexItem>
                            <HealthBadge health={gw.health} />
                          </FlexItem>
                        </Flex>
                      </FlexItem>
                      <FlexItem>
                        <AngleRightIcon color="var(--pf-t--global--text--color--subtle)" aria-hidden="true" />
                      </FlexItem>
                    </Flex>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                        gap: 16,
                        marginTop: 12,
                      }}
                    >
                      <Metric label={t('Requests / min')} value={gw.requestsPerMin.toLocaleString('en-US')} />
                      <Metric label={t('Success Rate')} value={`${gw.successRatePct}%`} tone={gw.successRatePct >= 95 ? 'good' : 'neutral'} />
                      <Metric label={t('Error Rate')} value={`${gw.errorRatePct}%`} tone={errorIsBad ? 'bad' : 'neutral'} />
                      <Metric label={t('Routes')} value={String(gw.routesCount)} />
                      <Metric label={t('Policies')} value={String(gw.policiesCount)} />
                    </div>
                  </div>
                </Link>
              </FlexItem>
            );
          })}
        </Flex>
      </CardBody>
    </Card>
  );
};

export default GatewayOperationalCards;
