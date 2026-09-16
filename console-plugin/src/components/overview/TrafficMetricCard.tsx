import * as React from 'react';
import { Card, CardBody, Flex, FlexItem } from '@patternfly/react-core';
import {
  ArrowUpIcon,
  ArrowDownIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline';
import { TrafficMetricData } from './types';

interface Props {
  data: TrafficMetricData;
}

/**
 * One operational traffic KPI: label, large value, % trend indicator,
 * sparkline. Colors trend green/red purely from the `trendIsGood` flag —
 * a falling Error Rate is good (green) even though the arrow points down,
 * so we never derive color from direction alone.
 */
export const TrafficMetricCard: React.FC<Props> = ({ data }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const trendColor = data.trendIsGood
    ? 'var(--pf-t--global--color--status--success--default)'
    : 'var(--pf-t--global--color--status--danger--default)';
  const sparkColor = data.trendIsGood
    ? 'var(--pf-t--global--color--status--success--default)'
    : 'var(--pf-t--global--color--status--danger--default)';

  const TrendArrow = data.trendDirection === 'up' ? ArrowUpIcon : ArrowDownIcon;
  const trendText = `${data.trendDeltaPct}%`;

  return (
    <Card isCompact aria-label={t('{{label}} metric', { label: t(data.label) })}>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsXs' }}>
          <FlexItem>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: 'var(--pf-t--global--text--color--subtle)',
              }}
            >
              {t(data.label)}
            </span>
          </FlexItem>
          <FlexItem>
            <Flex
              alignItems={{ default: 'alignItemsBaseline' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: 'var(--pf-t--global--text--color--regular)',
                  }}
                >
                  {data.value}
                </span>
              </FlexItem>
              <FlexItem>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    color: trendColor,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <TrendArrow aria-hidden="true" />
                  {trendText}
                </span>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <div style={{ color: sparkColor, width: '100%' }}>
              <Sparkline data={data.sparkline} color={sparkColor} width={260} height={40} />
            </div>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

export default TrafficMetricCard;
