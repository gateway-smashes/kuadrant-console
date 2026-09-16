import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import TrafficMetricCard from './TrafficMetricCard';
import { TrafficMetricData } from './types';

interface Props {
  metrics: TrafficMetricData[];
  windowLabel?: string;
}

/**
 * Wraps the 4 traffic KPIs in a single titled card with a "(Last 24h)" hint.
 * Inside is a 2x2 grid on small viewports, 4x1 on xl.
 */
export const TrafficOverviewSection: React.FC<Props> = ({
  metrics,
  windowLabel,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const label = windowLabel ?? t('(Last 24h)');
  return (
    <Card aria-label={t('Traffic overview')}>
      <CardTitle>
        <span style={{ fontSize: 16 }}>
          {t('Traffic Overview')}{' '}
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontWeight: 400 }}>
            {label}
          </span>
        </span>
      </CardTitle>
      <CardBody>
        <Grid hasGutter>
          {metrics.map((m) => (
            <GridItem key={m.id} xl={3} lg={6} md={6} sm={12}>
              <TrafficMetricCard data={m} />
            </GridItem>
          ))}
        </Grid>
      </CardBody>
    </Card>
  );
};

export default TrafficOverviewSection;
