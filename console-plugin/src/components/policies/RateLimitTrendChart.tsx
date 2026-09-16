import * as React from 'react';
import {
  Chart,
  ChartArea,
  ChartAxis,
  ChartGroup,
  ChartVoronoiContainer,
  ChartThemeColor,
} from '@patternfly/react-charts/victory';
import { Card, CardBody, CardTitle } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { usePrometheusRange } from '../../hooks/usePrometheusRange';
import { useResponsiveChartWidth } from '../../hooks/useResponsiveChartWidth';
import {
  rateLimitAllowedRangeQuery,
  rateLimitRejectionsRangeQuery,
} from '../../utils/prometheusQueries';

interface Props {
  targetKind: 'Gateway' | 'HTTPRoute';
  targetName: string;
  targetNamespace: string;
  /**
   * Lookback window. 1h (default) shows tactical "is the limit firing right
   * now"; 24h answers "how often does this policy actually throttle". The
   * Detail page renders 1h to match the user's mental model when they open
   * the page mid-incident.
   */
  durationSeconds?: number;
  /** Aggregation step for the range query — 60s sits at parity with UWM scrape. */
  stepSeconds?: number;
  title?: string;
}

// Allowed = green; rejected = danger red. Matches the visual tone used on
// other PatternFly traffic charts so a user scanning multiple cards can
// pattern-match colour to meaning without reading legends.
const COLORS = ['#3E8635', '#C9190B'];

function formatTime(input: Date | number | string): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * "Allowed vs rejected" mini-chart for a rate-limit policy. Two stacked
 * areas over the lookback window. Lets the user see at a glance when the
 * limit started biting and how badly — far more useful than a static
 * "rejection rate %" number for diagnosing incidents.
 *
 * Uses the same range-query hook as the Metrics tab on Gateway/HTTPRoute.
 */
export default function RateLimitTrendChart({
  targetKind,
  targetName,
  targetNamespace,
  durationSeconds = 3600,
  stepSeconds = 60,
  title,
}: Props) {
  const { t } = useTranslation('plugin__kuadrant-console');

  const queries = React.useMemo(
    () => [
      {
        label: t('Allowed'),
        query: rateLimitAllowedRangeQuery(targetNamespace, targetName, targetKind, '5m'),
      },
      {
        label: t('Rejected'),
        query: rateLimitRejectionsRangeQuery(targetNamespace, targetName, targetKind, '5m'),
      },
    ],
    [targetKind, targetName, targetNamespace, t],
  );

  const { series, loaded, metricsAvailable } = usePrometheusRange(
    queries,
    durationSeconds,
    stepSeconds,
  );

  const hasData = series.some((s) => s.data.length > 0);
  const legendData = [
    { name: t('Allowed'), symbol: { fill: COLORS[0] } },
    { name: t('Rejected'), symbol: { fill: COLORS[1] } },
  ];

  const [containerRef, chartWidth] = useResponsiveChartWidth();

  return (
    <Card isCompact>
      <CardTitle>{title || `${t('Usage trend')} (${t('last hour')})`}</CardTitle>
      <CardBody>
        {!metricsAvailable ? (
          <Empty>{t('Cluster Prometheus is unreachable')}</Empty>
        ) : !loaded ? (
          <Empty>{t('Loading…')}</Empty>
        ) : !hasData ? (
          <Empty>
            {t('No traffic recorded in the window — the chart populates once requests flow through the target.')}
          </Empty>
        ) : (
          <div ref={containerRef} style={{ width: '100%' }}>
            <Chart
              width={chartWidth}
              height={220}
              padding={{ top: 10, bottom: 50, left: 60, right: 20 }}
              scale={{ x: 'time' }}
              containerComponent={
                <ChartVoronoiContainer
                  labels={({ datum }: { datum: { x: Date; y: number; childName: string } }) =>
                    `${datum.childName}: ${datum.y?.toFixed(2)} req/s`
                  }
                />
              }
              legendData={legendData}
              legendPosition="bottom"
              themeColor={ChartThemeColor.multiUnordered}
            >
              <ChartAxis tickFormat={(t) => formatTime(t)} fixLabelOverlap />
              <ChartAxis dependentAxis tickFormat={(t: number) => t.toFixed(1)} />
              <ChartGroup>
                {series.map((s, i) => (
                  <ChartArea
                    key={s.label}
                    name={s.label}
                    data={s.data.map((d) => ({ x: d.x, y: d.y }))}
                    style={{
                      data: {
                        fill: COLORS[i],
                        fillOpacity: 0.3,
                        stroke: COLORS[i],
                      },
                    }}
                  />
                ))}
              </ChartGroup>
            </Chart>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--pf-t--global--text--color--subtle)',
        textAlign: 'center',
        padding: '0 20px',
      }}
    >
      {children}
    </div>
  );
}
