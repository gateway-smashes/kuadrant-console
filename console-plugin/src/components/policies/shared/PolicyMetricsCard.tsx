import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';

interface Props {
  title?: string;
  loaded?: boolean;
  metricsAvailable?: boolean;
  children: React.ReactNode;
}

/**
 * Container for kind-specific runtime metrics. When Prometheus is
 * unavailable on the cluster (`metricsAvailable === false`) we render a
 * single calibrated empty state instead of having every per-kind card
 * implement the fallback.
 */
export const PolicyMetricsCard: React.FC<Props> = ({
  title,
  loaded = true,
  metricsAvailable = true,
  children,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  return (
    <Card>
      <CardTitle>{title || t('Runtime Metrics')}</CardTitle>
      <CardBody>
        {!metricsAvailable ? (
          <EmptyState variant="sm" titleText={t('Metrics unavailable')} headingLevel="h4">
            <EmptyStateBody>
              {t('Prometheus is not reachable on this cluster, or this policy has no metrics exporter.')}
            </EmptyStateBody>
          </EmptyState>
        ) : !loaded ? (
          <div style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 13 }}>
            {t('Loading metrics…')}
          </div>
        ) : (
          children
        )}
      </CardBody>
    </Card>
  );
};

export default PolicyMetricsCard;
