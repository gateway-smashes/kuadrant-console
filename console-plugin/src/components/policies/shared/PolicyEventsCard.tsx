import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { K8sCondition } from '../../../types';
import { PolicyResource } from './types';

interface Props {
  policy: PolicyResource;
}

function isoToHuman(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface TimelineEntry {
  id: string;
  ts: number;
  iso?: string;
  type: string;
  status: string;
  reason: string;
  message: string;
}

/**
 * Reconciliation history card — k8s doesn't emit Events for Kuadrant
 * policies (the operator writes everything into status.conditions), so
 * we synthesise a timeline from condition lastTransitionTime values.
 * Sorted newest-first, capped at 8 entries — enough to show "what
 * happened the last few times the controller touched this".
 */
export const PolicyEventsCard: React.FC<Props> = ({ policy }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const conds: K8sCondition[] = (policy.status?.conditions as K8sCondition[] | undefined) || [];

  const entries: TimelineEntry[] = conds
    .map((c) => ({
      id: `${c.type}-${c.lastTransitionTime || ''}`,
      ts: c.lastTransitionTime ? new Date(c.lastTransitionTime).getTime() : 0,
      iso: c.lastTransitionTime,
      type: c.type,
      status: c.status,
      reason: c.reason || '',
      message: c.message || '',
    }))
    .filter((e) => e.ts > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);

  return (
    <Card>
      <CardTitle>{t('Events')}</CardTitle>
      <CardBody>
        {entries.length === 0 ? (
          <EmptyState variant="sm" titleText={t('No reconciliation history')} headingLevel="h4">
            <EmptyStateBody>
              {t('The controller has not yet reported any condition transitions for this policy.')}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  borderLeft: '2px solid var(--pf-t--global--border--color--default)',
                  paddingLeft: 12,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {isoToHuman(e.iso)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {e.type} <span style={{ fontWeight: 400 }}>= {e.status}</span>
                  {e.reason && (
                    <span style={{ marginLeft: 8, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      ({e.reason})
                    </span>
                  )}
                </div>
                {e.message && (
                  <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                    {e.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default PolicyEventsCard;
