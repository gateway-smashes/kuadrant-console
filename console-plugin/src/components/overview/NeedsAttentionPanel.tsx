import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
} from '@patternfly/react-core';
import {
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  InfoCircleIcon,
  AngleRightIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { NeedsAttentionItem } from './types';

interface Props {
  items: NeedsAttentionItem[];
  onViewAll?: () => void;
}

const SEVERITY_ICON: Record<NeedsAttentionItem['severity'], React.ReactNode> = {
  critical: (
    <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default)" aria-hidden="true" />
  ),
  warning: (
    <ExclamationTriangleIcon color="var(--pf-t--global--color--status--warning--default)" aria-hidden="true" />
  ),
  info: (
    <InfoCircleIcon color="var(--pf-t--global--color--status--info--default)" aria-hidden="true" />
  ),
};

const SEVERITY_RANK: Record<NeedsAttentionItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Prioritized list of operational issues. Always sorted critical → warning
 * → info so the most urgent item is at the top regardless of insertion order.
 */
export const NeedsAttentionPanel: React.FC<Props> = ({ items, onViewAll }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const sorted = React.useMemo(
    () => [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    [items],
  );

  return (
    <Card aria-label={t('Items that need attention')}>
      <CardTitle>{t('Needs Attention')}</CardTitle>
      <CardBody>
        {sorted.length === 0 ? (
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 13 }}>
            {t('All clear — no operational issues at the moment.')}
          </span>
        ) : (
          <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
            {sorted.map((it) => (
              <FlexItem key={it.id}>
                <Link
                  to={it.href}
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
                    spaceItems={{ default: 'spaceItemsMd' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                  >
                    <FlexItem>
                      <Flex
                        alignItems={{ default: 'alignItemsCenter' }}
                        spaceItems={{ default: 'spaceItemsSm' }}
                      >
                        <FlexItem>{SEVERITY_ICON[it.severity]}</FlexItem>
                        <FlexItem>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: 'var(--pf-t--global--text--color--regular)',
                            }}
                          >
                            {it.title}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--pf-t--global--text--color--subtle)',
                            }}
                          >
                            {it.detail}
                          </div>
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                    <FlexItem>
                      <Flex
                        alignItems={{ default: 'alignItemsCenter' }}
                        spaceItems={{ default: 'spaceItemsSm' }}
                      >
                        <FlexItem>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--pf-t--global--text--color--subtle)',
                            }}
                          >
                            {it.occurredAt}
                          </span>
                        </FlexItem>
                        <FlexItem>
                          <AngleRightIcon
                            color="var(--pf-t--global--text--color--subtle)"
                            aria-hidden="true"
                          />
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                  </Flex>
                </Link>
              </FlexItem>
            ))}
          </Flex>
        )}
        {onViewAll && sorted.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Button variant="link" isInline onClick={onViewAll}>
              {t('View all alerts')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default NeedsAttentionPanel;
