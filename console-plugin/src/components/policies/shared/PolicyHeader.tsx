import * as React from 'react';
import {
  Flex,
  FlexItem,
  Label,
  Title,
  Breadcrumb,
  BreadcrumbItem,
  Button,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PolicyKind } from './types';
import { PolicyStatusSummary } from './state';
import { PolicyTargetReference } from '../../../types/common';

interface Props {
  policyName: string;
  policyKind: PolicyKind;
  kindLabel: string;
  namespace: string;
  summary: PolicyStatusSummary;
  targetRef?: PolicyTargetReference;
  // Absolute href for "View in YAML editor" — points at the native Console
  // CR detail page so the operator can still drop down to kubectl-style work
  // when the operational view isn't enough.
  yamlHref?: string;
  // Optional actions slot rendered in the top-right corner. When set, it
  // replaces the built-in "Edit YAML" link so callers can drop in a richer
  // menu (e.g. the shared ResourceActionsMenu with Edit YAML + Delete).
  actions?: React.ReactNode;
}

const STATE_COLOR: Record<PolicyStatusSummary['state'], 'green' | 'orange' | 'blue' | 'grey'> = {
  healthy: 'green',
  degraded: 'orange',
  progressing: 'blue',
  unknown: 'grey',
};

const STATE_LABEL: Record<PolicyStatusSummary['state'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  progressing: 'Progressing',
  unknown: 'Unknown',
};

/**
 * Top-of-page operational header for any Kuadrant policy detail view.
 * Carries:
 *   - breadcrumb back to /policies
 *   - title with kind badge
 *   - status pills (state, Accepted, Enforced)
 *   - target line with click-through
 *   - actions: View YAML
 */
export const PolicyHeader: React.FC<Props> = ({
  policyName,
  policyKind,
  kindLabel,
  namespace,
  summary,
  targetRef,
  yamlHref,
  actions,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const targetLine = targetRef
    ? `${targetRef.kind}/${targetRef.name}`
    : t('No target');

  return (
    <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
      <FlexItem>
        <Breadcrumb>
          <BreadcrumbItem>
            <Link to="/connectivity-link/policies">{t('Policies')}</Link>
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{policyName}</BreadcrumbItem>
        </Breadcrumb>
      </FlexItem>
      <FlexItem>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <Title headingLevel="h1">{policyName}</Title>
              </FlexItem>
              <FlexItem>
                <Label color="blue" isCompact>{kindLabel}</Label>
              </FlexItem>
              <FlexItem>
                <Label color={STATE_COLOR[summary.state]} isCompact>
                  {t(STATE_LABEL[summary.state])}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label
                  color={summary.accepted ? 'green' : 'grey'}
                  isCompact
                  variant={summary.accepted ? 'filled' : 'outline'}
                >
                  {summary.accepted ? t('Accepted') : t('Not Accepted')}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label
                  color={summary.enforced ? 'green' : 'grey'}
                  isCompact
                  variant={summary.enforced ? 'filled' : 'outline'}
                >
                  {summary.enforced ? t('Enforced') : t('Not Enforced')}
                </Label>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            {actions
              ? actions
              : yamlHref && (
                  <Button
                    variant="link"
                    component={(props) => <Link {...props} to={yamlHref} />}
                    icon={<ExternalLinkAltIcon />}
                    iconPosition="right"
                  >
                    {t('Edit YAML')}
                  </Button>
                )}
          </FlexItem>
        </Flex>
      </FlexItem>
      <FlexItem>
        <div
          style={{
            fontSize: 14,
            color: 'var(--pf-t--global--text--color--subtle)',
          }}
        >
          {t('Namespace')}: <strong>{namespace}</strong>
          {'  ·  '}
          {t('Target')}: <strong>{targetLine}</strong>
        </div>
      </FlexItem>
      {policyKind === 'AuthPolicy' && summary.message && summary.state === 'degraded' && (
        <FlexItem>
          <span
            style={{
              fontSize: 12,
              color: 'var(--pf-t--global--color--status--warning--default)',
            }}
          >
            {summary.message}
          </span>
        </FlexItem>
      )}
    </Flex>
  );
};

export default PolicyHeader;
