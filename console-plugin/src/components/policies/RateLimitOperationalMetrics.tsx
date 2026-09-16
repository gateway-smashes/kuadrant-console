import * as React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Spinner,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  Title,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import { consoleFetch } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  requestRateQuery,
  rateLimitRejectionsQuery,
  rateLimitRejectionsTotalQuery,
} from '../../utils/prometheusQueries';
import { ratesToRpm } from './RateLimitVisualizer';
import type { RateLimit } from '../../types';

interface Props {
  targetKind: 'Gateway' | 'HTTPRoute';
  targetName: string;
  targetNamespace: string;
  /** Merged limits map from the policy (top-level + defaults + overrides). */
  limits: Record<string, RateLimit>;
  /** Polling cadence (ms). Defaults to 60s — matches UWM scrape interval. */
  pollInterval?: number;
}

interface Snapshot {
  /** Allowed traffic right now (req/s averaged over the last 5 min). */
  currentAllowedRps: number | null;
  /** Throttled traffic right now (429s/sec averaged over the last 5 min). */
  currentRejectedRps: number | null;
  /** Total 429s in the last 24h (used for the "Rejected (24h)" KPI). */
  rejectedTotal24h: number | null;
}

const EMPTY: Snapshot = {
  currentAllowedRps: null,
  currentRejectedRps: null,
  rejectedTotal24h: null,
};

async function instant(query: string): Promise<number | null> {
  const url = `/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await consoleFetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const v = json?.data?.result?.[0]?.value?.[1];
  return v !== undefined ? parseFloat(v) : null;
}

/**
 * Operational header for the RateLimitPolicy detail page: 5 KPI cards that
 * answer "is this limit doing anything right now?". Reads live metrics
 * from Istio telemetry via the in-cluster Prometheus.
 *
 * The "configured" KPI is the *tightest* rate across the policy's named
 * limits (e.g. bronze's 10/min wins over silver's 50/min if both attached);
 * that's the worst-case ceiling a consumer can hit. "Unlimited" when no
 * concrete rate is declared (gold-tier style).
 */
export default function RateLimitOperationalMetrics({
  targetKind,
  targetName,
  targetNamespace,
  limits,
  pollInterval = 60_000,
}: Props) {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [snap, setSnap] = React.useState<Snapshot>(EMPTY);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  // Configured ceiling — derived from the policy spec, no Prometheus needed.
  // Picks the tightest rpm across all limits because that's the strictest
  // bound any single consumer can hit.
  const configuredRpm = React.useMemo(() => {
    const rates = Object.values(limits)
      .map((l) => ratesToRpm(l.rates))
      .filter((r): r is number => r !== undefined);
    return rates.length === 0 ? null : Math.min(...rates);
  }, [limits]);

  // Total traffic — used to compute the "current %" KPI. We poll it alongside
  // the rate-limit-specific queries so they share a request budget.
  const totalRpsQuery = requestRateQuery(targetNamespace, targetName, targetKind, '5m');
  const rejectedRpsQuery = rateLimitRejectionsQuery(targetNamespace, targetName, targetKind, '5m');
  const rejected24hQuery = rateLimitRejectionsTotalQuery(targetNamespace, targetName, targetKind, '24h');

  const fetchSnapshot = React.useCallback(async () => {
    try {
      const [total, rejectedRps, rejected24h] = await Promise.all([
        instant(totalRpsQuery),
        instant(rejectedRpsQuery),
        instant(rejected24hQuery),
      ]);
      // Allowed = total − rejected. Floored at 0 to be defensive (averaging
      // windows can briefly produce a negative if rejection rate samples lag).
      const allowed =
        total !== null && rejectedRps !== null
          ? Math.max(0, total - rejectedRps)
          : total;
      setSnap({
        currentAllowedRps: allowed,
        currentRejectedRps: rejectedRps,
        rejectedTotal24h: rejected24h,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoaded(true);
    }
  }, [totalRpsQuery, rejectedRpsQuery, rejected24hQuery]);

  React.useEffect(() => {
    fetchSnapshot();
    const handle = setInterval(fetchSnapshot, pollInterval);
    return () => clearInterval(handle);
  }, [fetchSnapshot, pollInterval]);

  if (!loaded) {
    return (
      <Card>
        <CardBody>
          <Bullseye style={{ minHeight: 80 }}>
            <Spinner size="md" />
          </Bullseye>
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <EmptyState variant="sm" titleText={t('Metrics unavailable')} headingLevel="h4">
            <EmptyStateBody>{error.message}</EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  // Derived KPIs for display.
  const currentRpm =
    snap.currentAllowedRps !== null ? snap.currentAllowedRps * 60 : null;
  const utilisationPct =
    configuredRpm !== null && currentRpm !== null && configuredRpm > 0
      ? Math.min(100, Math.round((currentRpm / configuredRpm) * 100))
      : null;
  const availableRpm =
    configuredRpm !== null && currentRpm !== null
      ? Math.max(0, configuredRpm - currentRpm)
      : null;
  const rejectionPct =
    snap.currentAllowedRps !== null && snap.currentRejectedRps !== null
      ? (() => {
          const total = snap.currentAllowedRps + snap.currentRejectedRps;
          return total > 0 ? (snap.currentRejectedRps / total) * 100 : 0;
        })()
      : null;

  return (
    <Grid hasGutter>
      <GridItem md={2} sm={6}>
        <Kpi
          label={t('Configured limit')}
          value={configuredRpm === null ? '∞' : formatRpm(configuredRpm)}
          hint={configuredRpm === null ? t('Unlimited') : t('req/min (tightest tier)')}
        />
      </GridItem>
      <GridItem md={2} sm={6}>
        <Kpi
          label={t('Current usage')}
          value={currentRpm === null ? '—' : formatRpm(currentRpm)}
          hint={
            utilisationPct === null
              ? t('req/min (live)')
              : `${utilisationPct}% ${t('of configured')}`
          }
          tone={utilisationPct === null ? 'neutral' : utilisationToTone(utilisationPct)}
        />
      </GridItem>
      <GridItem md={2} sm={6}>
        <Kpi
          label={t('Available')}
          value={availableRpm === null ? '—' : formatRpm(availableRpm)}
          hint={t('req/min headroom')}
        />
      </GridItem>
      <GridItem md={3} sm={6}>
        <Kpi
          label={t('Rejected (24h)')}
          value={snap.rejectedTotal24h === null ? '—' : formatCount(snap.rejectedTotal24h)}
          hint={
            snap.currentRejectedRps !== null
              ? `${snap.currentRejectedRps.toFixed(2)} ${t('req/s now')}`
              : t('429s last 24h')
          }
          tone={(snap.rejectedTotal24h ?? 0) > 0 ? 'critical' : 'neutral'}
        />
      </GridItem>
      <GridItem md={3} sm={6}>
        <Kpi
          label={t('Rejection rate')}
          value={rejectionPct === null ? '—' : `${rejectionPct.toFixed(1)}%`}
          hint={t('last 5 min')}
          tone={
            rejectionPct === null
              ? 'neutral'
              : rejectionPct > 5
                ? 'critical'
                : rejectionPct > 0
                  ? 'warning'
                  : 'neutral'
          }
        />
      </GridItem>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'warning' | 'critical' | 'success';

function utilisationToTone(pct: number): Tone {
  if (pct >= 95) return 'critical';
  if (pct >= 80) return 'warning';
  return 'success';
}

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--pf-t--global--text--color--regular)',
  success: 'var(--pf-t--global--color--status--success--default)',
  warning: 'var(--pf-t--global--color--status--warning--default)',
  critical: 'var(--pf-t--global--color--status--danger--default)',
};

function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card isCompact isFullHeight>
      <CardTitle style={{ paddingBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>{label}</span>
      </CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsNone' }}>
          <FlexItem>
            <Title headingLevel="h3" size="2xl" style={{ color: TONE_COLOR[tone] }}>
              {value}
            </Title>
          </FlexItem>
          {hint && (
            <FlexItem>
              <span style={{ fontSize: 11, color: 'var(--pf-t--global--text--color--subtle)' }}>{hint}</span>
            </FlexItem>
          )}
        </Flex>
      </CardBody>
    </Card>
  );
}

function formatRpm(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

function formatCount(n: number): string {
  const rounded = Math.round(n);
  return rounded.toLocaleString();
}
