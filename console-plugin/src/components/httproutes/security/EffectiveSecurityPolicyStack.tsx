import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Label,
  Divider,
  EmptyState,
  EmptyStateBody,
  Icon,
} from '@patternfly/react-core';
import { ArrowRightIcon } from '@patternfly/react-icons';
import { PolicyAttachment } from '../../../types';
import { POLICY_KIND_LABELS, policyResourceURL } from '../../../models';
import { getPolicyLevel } from '../../../utils/policyMerge';

interface Props {
  stack: PolicyAttachment[];
}

/**
 * Security-focused view of the GEP-713 effective stack. Same underlying
 * model as EffectivePolicyStack (the standalone tab) but rendered:
 *   - filtered to security kinds (Auth, RateLimit, TokenRateLimit, TLS)
 *   - grouped by kind so operators see "everything Auth-related at once"
 *
 * Non-security kinds (DNS + anything discovered) are intentionally left
 * for the Effective policy stack tab — this card is meant to answer
 * "what protects requests to this route right now".
 */
export const EffectiveSecurityPolicyStack: React.FC<Props> = ({ stack }) => {
  const security = stack.filter((p) =>
    ['AuthPolicy', 'RateLimitPolicy', 'TokenRateLimitPolicy', 'TLSPolicy'].includes(p.policyKind),
  );

  if (security.length === 0) {
    return (
      <Card>
        <CardTitle>Effective Security Policy Stack</CardTitle>
        <CardBody>
          <EmptyState variant="sm" titleText="No security policies affect this route" headingLevel="h4">
            <EmptyStateBody>
              This route inherits its security posture from the parent Gateway configuration only.
            </EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Effective Security Policy Stack</CardTitle>
      <CardBody>
        <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
          {security.map((pa) => (
            <FlexItem key={pa.policy.metadata?.uid}>
              <StackRow attachment={pa} />
            </FlexItem>
          ))}
        </Flex>
        <Divider style={{ marginTop: 16, marginBottom: 12 }} />
        <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
          Resolution order per GEP-713:{' '}
          <Label color="blue" isCompact>Gateway overrides</Label>{' '}
          <Icon size="sm"><ArrowRightIcon /></Icon>{' '}
          <Label color="purple" isCompact>Route overrides</Label>{' '}
          <Icon size="sm"><ArrowRightIcon /></Icon>{' '}
          <Label color="teal" isCompact>Route defaults</Label>{' '}
          <Icon size="sm"><ArrowRightIcon /></Icon>{' '}
          <Label color="grey" isCompact>Gateway defaults</Label>
        </div>
      </CardBody>
    </Card>
  );
};

const StackRow: React.FC<{ attachment: PolicyAttachment }> = ({ attachment }) => {
  const { policy, policyKind, targetRef, isOverridden, isEnforced } = attachment;
  const name = policy.metadata?.name || '';
  const ns = policy.metadata?.namespace || '';
  const level = getPolicyLevel(policy);
  const isGateway = targetRef.kind === 'Gateway';
  return (
    <Card isCompact style={{ opacity: isOverridden ? 0.5 : 1 }}>
      <CardBody>
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Label color="blue">{POLICY_KIND_LABELS[policyKind] || policyKind}</Label>
          </FlexItem>
          <FlexItem>
            <Link to={policyResourceURL(policyKind, ns, name)}>{ns}/{name}</Link>
          </FlexItem>
          <FlexItem>
            <Label color={isGateway ? 'purple' : 'teal'}>{isGateway ? 'Gateway' : 'Route'}</Label>
          </FlexItem>
          <FlexItem>
            <Label color={level === 'override' ? 'orange' : 'grey'}>
              {level === 'override' ? 'Override' : 'Default'}
            </Label>
          </FlexItem>
          <FlexItem>
            {isOverridden ? (
              <Label color="orange">Overridden</Label>
            ) : isEnforced ? (
              <Label color="green">Enforced</Label>
            ) : (
              <Label color="red">Not Enforced</Label>
            )}
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
};
