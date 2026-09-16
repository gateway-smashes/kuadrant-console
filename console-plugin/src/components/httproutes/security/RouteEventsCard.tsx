import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
  Label,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { RecentEvent } from '../../overview/types';

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
 * Route-scoped recent events. Same visual as the Overview page's
 * RecentEventsPanel but data comes from `useHTTPRouteEvents` (route + its
 * attached policies only).
 */
export const RouteEventsCard: React.FC<Props> = ({ events }) => {
  return (
    <Card>
      <CardTitle>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>Recent Events</FlexItem>
          <FlexItem>
            <Button
              variant="link"
              isInline
              component={(props) => <Link {...props} to="/k8s/all-namespaces/core~v1~Event" />}
            >
              View all
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        {events.length === 0 ? (
          <EmptyState variant="sm" titleText="No recent security events" headingLevel="h4">
            <EmptyStateBody>
              This route and its attached policies have not reported any recent condition
              transitions.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
            {events.map((e) => (
              <FlexItem key={e.id}>
                <div
                  style={{
                    display: 'block',
                    padding: '8px 0',
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
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{e.title}</div>
                      {e.detail && (
                        <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                          {e.detail}
                        </div>
                      )}
                    </FlexItem>
                    <FlexItem>
                      <Label isCompact color={SEVERITY_COLOR[e.severity]} variant="outline">
                        {e.severity}
                      </Label>
                    </FlexItem>
                  </Flex>
                </div>
              </FlexItem>
            ))}
          </Flex>
        )}
      </CardBody>
    </Card>
  );
};
