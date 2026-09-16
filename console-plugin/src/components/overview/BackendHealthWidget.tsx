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
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Sparkline from './Sparkline';
import { BackendRow, HealthSeverity } from './types';
import { OVERVIEW_LIST_LIMIT, ListCardFooter, rankByHealth } from './overviewList';

interface Props {
  rows: BackendRow[];
}

/**
 * Inline donut written as SVG arc segments (cheaper than wiring
 * @patternfly/react-charts just for a 64x64 indicator). Three slices:
 * healthy / warning / down. Center number is total backends.
 */
const Donut: React.FC<{ healthy: number; warning: number; critical: number }> = ({
  healthy,
  warning,
  critical,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const size = 110;
  const r = 42;
  const cx = size / 2;
  const cy = size / 2;
  const total = healthy + warning + critical || 1;
  const segments = [
    { value: healthy, color: 'var(--pf-t--global--color--status--success--default)' },
    { value: warning, color: 'var(--pf-t--global--color--status--warning--default)' },
    { value: critical, color: 'var(--pf-t--global--color--status--danger--default)' },
  ];
  let angleAcc = -90; // start at 12 o'clock
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const angle = (s.value / total) * 360;
      // A single slice that fills the whole ring (e.g. every backend Warning)
      // can't be drawn with one SVG arc: the start and end points coincide, so
      // the `A` path renders as nothing and only the grey track shows through
      // ("donut apagado"). Draw a full <circle> in that colour instead.
      if (angle >= 359.999) {
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={12} />
        );
      }
      const a0 = (angleAcc * Math.PI) / 180;
      const a1 = ((angleAcc + angle) * Math.PI) / 180;
      angleAcc += angle;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const largeArc = angle > 180 ? 1 : 0;
      const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
      return <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={12} strokeLinecap="butt" />;
    });
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--pf-t--global--border--color--default)" strokeWidth={12} />
      {arcs}
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        fontSize={20}
        fontWeight={700}
        fill="var(--pf-t--global--text--color--regular)"
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fontSize={10}
        fill="var(--pf-t--global--text--color--subtle)"
      >
        {t('Total')}
      </text>
    </svg>
  );
};

const HEALTH_ICON: Record<HealthSeverity, React.ReactNode> = {
  healthy: <CheckCircleIcon color="var(--pf-t--global--color--status--success--default)" aria-hidden="true" />,
  warning: <ExclamationTriangleIcon color="var(--pf-t--global--color--status--warning--default)" aria-hidden="true" />,
  critical: <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default)" aria-hidden="true" />,
  info: <CheckCircleIcon color="var(--pf-t--global--color--status--info--default)" aria-hidden="true" />,
  accepted: <CheckCircleIcon color="var(--pf-t--global--color--status--info--default)" aria-hidden="true" />,
};

export const BackendHealthWidget: React.FC<Props> = ({ rows }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const healthLabel: Record<HealthSeverity, string> = {
    healthy: t('Healthy'),
    warning: t('Warning'),
    critical: t('Down'),
    info: t('Info'),
    accepted: t('Accepted'),
  };
  const counts = React.useMemo(() => {
    let h = 0, w = 0, c = 0;
    for (const r of rows) {
      if (r.health === 'healthy') h++;
      else if (r.health === 'warning') w++;
      else if (r.health === 'critical') c++;
    }
    return { h, w, c };
  }, [rows]);

  // Donut counts stay over ALL rows (full picture); the table shows only the
  // top-N ranked worst-first so problems are always on the first screen.
  const visible = React.useMemo(
    () => rankByHealth(rows).slice(0, OVERVIEW_LIST_LIMIT),
    [rows],
  );

  return (
    <Card aria-label={t('Backend health')}>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>{t('Backends')}</FlexItem>
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
        <Flex spaceItems={{ default: 'spaceItemsXl' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Flex
              direction={{ default: 'column' }}
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <Donut healthy={counts.h} warning={counts.w} critical={counts.c} />
              </FlexItem>
              <FlexItem>
                <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsXs' }}>
                  <FlexItem>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--pf-t--global--color--status--success--default)' }} />
                      {t('{{count}} Healthy', { count: counts.h })}
                    </span>
                  </FlexItem>
                  <FlexItem>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--pf-t--global--color--status--warning--default)' }} />
                      {t('{{count}} Warning', { count: counts.w })}
                    </span>
                  </FlexItem>
                  <FlexItem>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--pf-t--global--color--status--danger--default)' }} />
                      {t('{{count}} Down', { count: counts.c })}
                    </span>
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem flex={{ default: 'flex_1' }}>
            <Table variant="compact" borders={false} aria-label={t('Backends')}>
              <Thead>
                <Tr>
                  <Th>{t('Backend')}</Th>
                  <Th>{t('Namespace')}</Th>
                  <Th>{t('Health')}</Th>
                  <Th>{t('Req / min')}</Th>
                  <Th>{t('Trend')}</Th>
                  <Th>{t('Error')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link to={r.href}>{r.name}</Link>
                    </Td>
                    <Td>{r.namespace}</Td>
                    <Td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        {HEALTH_ICON[r.health]}
                        {healthLabel[r.health]}
                      </span>
                    </Td>
                    <Td>{r.requestsPerMin.toLocaleString('en-US')}</Td>
                    <Td>
                      <div style={{ color: 'var(--pf-t--global--color--status--info--default)', width: 80 }}>
                        <Sparkline data={r.sparkline} width={80} height={24} strokeWidth={1.25} responsive={false} />
                      </div>
                    </Td>
                    <Td>{r.errorRatePct}%</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <ListCardFooter shown={visible.length} total={rows.length} />
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};

export default BackendHealthWidget;
