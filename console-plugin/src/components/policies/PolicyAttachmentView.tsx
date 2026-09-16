import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Label,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { useAttachedPolicies } from '../../hooks/useAttachedPolicies';
import { POLICY_KIND_LABELS, policyResourceURL } from '../../models';
import { PolicyAttachment, RateLimitPolicy } from '../../types';
import { isConditionTrue, getConditionMessage } from '../../utils/status';
import { AuthPolicyEnforcedToggle } from './AuthPolicyEnforcedToggle';
import RateLimitVisualizer from './RateLimitVisualizer';

interface PolicyAttachmentViewProps {
  targetKind: string;
  targetName: string;
  targetNamespace: string;
  /**
   * Namespace of the parent Gateway. When viewing an HTTPRoute whose parent
   * Gateway lives in a different namespace (e.g. `openshift-ingress`), pass
   * it so the hook also watches policies attached cross-namespace. Optional —
   * if omitted, only the target's own namespace is watched.
   */
  gatewayNamespace?: string;
}

export const PolicyAttachmentView: React.FC<PolicyAttachmentViewProps> = ({
  targetKind,
  targetName,
  targetNamespace,
  gatewayNamespace,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const { policies, loaded, error } = useAttachedPolicies(
    targetKind,
    targetName,
    targetNamespace,
    gatewayNamespace,
  );

  if (!loaded) {
    return <Spinner size="lg" />;
  }

  if (error) {
    return (
      <EmptyState variant="sm" titleText={t('Error loading policies')} headingLevel="h3">
        <EmptyStateBody>{error.message}</EmptyStateBody>
      </EmptyState>
    );
  }

  if (policies.length === 0) {
    return (
      <EmptyState variant="sm" titleText={t('No policies found')} headingLevel="h3">
        <EmptyStateBody>
          {t('No policies are attached to this {{kind}}.', { kind: targetKind })}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
      {policies.map((pa) => (
        <FlexItem key={pa.policy.metadata?.uid}>
          <PolicyCard attachment={pa} targetNamespace={targetNamespace} />
        </FlexItem>
      ))}
    </Flex>
  );
};

const PolicyCard: React.FC<{ attachment: PolicyAttachment; targetNamespace: string }> = ({
  attachment,
  targetNamespace,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const { policy, policyKind, conditions, isOverridden, isEnforced } = attachment;
  const name = policy.metadata?.name || '';
  const ns = policy.metadata?.namespace || '';

  const accepted = isConditionTrue(conditions, 'Accepted');
  const enforcedMsg = getConditionMessage(conditions, 'Enforced');
  const overriddenMsg = getConditionMessage(conditions, 'Overridden');

  return (
    <Card isCompact>
      <CardTitle>
        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
          <FlexItem>
            <Label color="blue">{POLICY_KIND_LABELS[policyKind] || policyKind}</Label>
          </FlexItem>
          <FlexItem>
            <a href={policyResourceURL(policyKind, ns, name)}>{ns}/{name}</a>
          </FlexItem>
          <FlexItem>
            {isOverridden ? (
              <Label color="orange">{t('Overridden')}</Label>
            ) : isEnforced ? (
              <Label color="green">{t('Enforced')}</Label>
            ) : accepted ? (
              <Label color="blue">{t('Accepted')}</Label>
            ) : (
              <Label color="red">{t('Not Enforced')}</Label>
            )}
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <DescriptionList isHorizontal isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Target')}</DescriptionListTerm>
            <DescriptionListDescription>
              {attachment.targetRef.kind}/{attachment.targetRef.name}
            </DescriptionListDescription>
          </DescriptionListGroup>
          {enforcedMsg && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Enforced')}</DescriptionListTerm>
              <DescriptionListDescription>{enforcedMsg}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
          {overriddenMsg && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('Overridden')}</DescriptionListTerm>
              <DescriptionListDescription>{overriddenMsg}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>
        {policyKind === 'AuthPolicy' && (
          <div style={{ marginTop: 12 }}>
            <AuthPolicyEnforcedToggle policy={policy} namespace={targetNamespace} />
          </div>
        )}
        {/* For RateLimitPolicy, expand the card with a compact view of the
            limits so reviewers can see WHAT IS LIMITED without having to
            jump to the detail page. The "View policy" link still goes to
            the plugin-owned detail page above. */}
        {policyKind === 'RateLimitPolicy' && (
          <RateLimitLimitsSection policy={policy as RateLimitPolicy} ns={ns} policyName={name} />
        )}
      </CardBody>
    </Card>
  );
};

const RateLimitLimitsSection: React.FC<{
  policy: RateLimitPolicy;
  ns: string;
  policyName: string;
}> = ({ policy, ns, policyName }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const merged = {
    ...(policy.spec?.limits || {}),
    ...(policy.spec?.defaults?.limits || {}),
    ...(policy.spec?.overrides?.limits || {}),
  };
  if (Object.keys(merged).length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--pf-t--global--text--color--subtle)' }}>
        {t('Limits')}{' '}
        <a
          style={{ fontWeight: 400, marginLeft: 6 }}
          href={`/connectivity-link/policies/ratelimit/${ns}/${policyName}`}
        >
          {t('View details')} →
        </a>
      </div>
      <RateLimitVisualizer limits={merged} variant="compact" />
    </div>
  );
};
