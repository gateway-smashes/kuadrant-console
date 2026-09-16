import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HealthSeverity, PolicyImpactRow } from './types';

/**
 * The Overview is a glance surface, not a browser. Each list card shows only
 * the top few most-important rows (ranked worst-first) and links to the full,
 * paginated list via its "View all" action. This keeps the dashboard compact
 * and — crucially — guarantees the rows that need attention are always on the
 * first screen, instead of hiding on page 2 of a paginated card.
 */
export const OVERVIEW_LIST_LIMIT = 5;

/** Worst-first: problems bubble to the top of every capped list. */
const HEALTH_RANK: Record<HealthSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  accepted: 3,
  healthy: 4,
};

const POLICY_STATUS_RANK: Record<PolicyImpactRow['status'], number> = {
  failed: 0,
  overridden: 1,
  accepted: 2,
  enforced: 3,
};

/** Backends/gateways: worst health first, then busiest. */
export function rankByHealth<T extends { health: HealthSeverity; requestsPerMin: number }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || b.requestsPerMin - a.requestsPerMin,
  );
}

/** Routes: highest error rate first, then busiest. */
export function rankByError<T extends { errorRatePct: number; requestsPerMin: number }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => b.errorRatePct - a.errorRatePct || b.requestsPerMin - a.requestsPerMin,
  );
}

/** Policies: broken/overridden first, healthy (enforced) last. */
export function rankByPolicyStatus(rows: PolicyImpactRow[]): PolicyImpactRow[] {
  return [...rows].sort((a, b) => POLICY_STATUS_RANK[a.status] - POLICY_STATUS_RANK[b.status]);
}

/**
 * Subtle "Showing 5 of 12" caption, rendered only when the list was actually
 * capped. Right-aligned to sit under the table without competing with the
 * "View all" link in the card header.
 */
export const ListCardFooter: React.FC<{ shown: number; total: number }> = ({ shown, total }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  if (total <= shown) return null;
  return (
    <div
      style={{
        marginTop: 8,
        textAlign: 'right',
        fontSize: 12,
        color: 'var(--pf-t--global--text--color--subtle)',
      }}
    >
      {t('Showing {{shown}} of {{total}}', { shown, total })}
    </div>
  );
};
