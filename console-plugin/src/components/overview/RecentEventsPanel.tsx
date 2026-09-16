import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
  Label,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { RecentEvent } from './types';
import { OVERVIEW_LIST_LIMIT, ListCardFooter } from './overviewList';

interface Props {
  events: RecentEvent[];
}

const SEVERITY_COLOR: Record<RecentEvent['severity'], 'green' | 'blue' | 'orange' | 'red'> = {
  success: 'green',
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

/**
 * Stream of operational activity. In Phase 5 this should source from the
 * k8s Events API, filtered to RHCL-owned resources (Gateways, HTTPRoutes,
 * Policies, APIKey secrets), plus controller-emitted events from the
 * Kuadrant operator status conditions.
 */
export const RecentEventsPanel: React.FC<Props> = ({ events }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const severityLabel: Record<RecentEvent['severity'], string> = {
    success: t('Success'),
    info: t('Info'),
    warning: t('Warning'),
    critical: t('Critical'),
  };
  // Events arrive newest-first from the hook — keep that order, just cap.
  const visible = events.slice(0, OVERVIEW_LIST_LIMIT);
  return (
    <Card aria-label={t('Recent events')}>
      <CardTitle>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>{t('Recent Events')}</FlexItem>
          <FlexItem>
            <Button
              variant="link"
              isInline
              component={(props) => <Link {...props} to="/k8s/all-namespaces/core~v1~Event" />}
            >
              {t('View all')}
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
          {visible.map((e) => (
            <FlexItem key={e.id}>
              <Link
                to={e.href}
                style={{
                  display: 'block',
                  padding: '8px 0',
                  color: 'inherit',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--pf-t--global--border--color--default)',
                }}
              >
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  justifyContent={{ default: 'justifyContentSpaceBetween' }}
                  spaceItems={{ default: 'spaceItemsMd' }}
                >
                  <FlexItem flex={{ default: 'flex_1' }}>
                    <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      {e.occurredAt}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--pf-t--global--text--color--regular)' }}>
                      {e.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      {e.detail}
                    </div>
                  </FlexItem>
                  <FlexItem>
                    <Label isCompact color={SEVERITY_COLOR[e.severity]} variant="outline">
                      {severityLabel[e.severity]}
                    </Label>
                  </FlexItem>
                </Flex>
              </Link>
            </FlexItem>
          ))}
        </Flex>
        <ListCardFooter shown={visible.length} total={events.length} />
      </CardBody>
    </Card>
  );
};

export default RecentEventsPanel;
