import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
  Title,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Button,
  Flex,
  FlexItem,
  Spinner,
  Divider,
  Icon,
} from '@patternfly/react-core';
import { RedoIcon } from '@patternfly/react-icons';
import { FeatureStatusLabel } from './SecurityAtoms';
import {
  RouteSecuritySummary,
  SecurityFeatureSummary,
} from './routeSecurityTypes';

interface Props {
  summary: RouteSecuritySummary;
  headersLoading: boolean;
  headersConfigured: boolean;
  headersError?: string | null;
  onRunHeaderProbe: () => void;
  routeName: string;
  routeNamespace: string;
}

/**
 * The Security Details card on the Details tab. Compact subcards, one per
 * security domain. The Security tab renders the same feature model with
 * deeper information — reuse the same SubCard block to keep the visual
 * language consistent.
 */
export const SecurityDetailsCard: React.FC<Props> = ({
  summary,
  headersLoading,
  headersConfigured,
  headersError,
  onRunHeaderProbe,
  routeName,
  routeNamespace,
}) => {
  return (
    <Card>
      <CardTitle>Security Details</CardTitle>
      <CardBody>
        <Grid hasGutter>
          <GridItem md={6} sm={12}>
            <FeatureSubCard title="TLS" feature={summary.tls}>
              <FeatureLinks feature={summary.tls} routeName={routeName} routeNamespace={routeNamespace} />
            </FeatureSubCard>
          </GridItem>
          <GridItem md={6} sm={12}>
            <FeatureSubCard title="Authentication" feature={summary.authentication}>
              <FeatureLinks feature={summary.authentication} routeName={routeName} routeNamespace={routeNamespace} />
            </FeatureSubCard>
          </GridItem>
          <GridItem md={6} sm={12}>
            <FeatureSubCard title="Rate Limiting" feature={summary.rateLimiting}>
              <FeatureLinks feature={summary.rateLimiting} routeName={routeName} routeNamespace={routeNamespace} />
            </FeatureSubCard>
          </GridItem>
          <GridItem md={6} sm={12}>
            <FeatureSubCard title="Security Headers" feature={summary.headers}>
              <HeaderProbeActions
                loading={headersLoading}
                configured={headersConfigured}
                error={headersError}
                onRun={onRunHeaderProbe}
              />
            </FeatureSubCard>
          </GridItem>
        </Grid>
      </CardBody>
    </Card>
  );
};

interface SubCardProps {
  title: string;
  feature: SecurityFeatureSummary;
  children?: React.ReactNode;
}

export const FeatureSubCard: React.FC<SubCardProps> = ({ title, feature, children }) => {
  const details = feature.details || {};
  const entries = Object.entries(details).filter(([, v]) => v !== undefined && v !== '');
  return (
    <Card isCompact>
      <CardBody>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          style={{ marginBottom: 8 }}
        >
          <FlexItem>
            <Title headingLevel="h4" size="md">{title}</Title>
          </FlexItem>
          <FlexItem>
            <FeatureStatusLabel status={feature.status} label={feature.label} />
          </FlexItem>
        </Flex>
        {feature.description && (
          <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)', marginBottom: 8 }}>
            {feature.description}
          </div>
        )}
        {entries.length > 0 && (
          <>
            <Divider />
            <DescriptionList isCompact isAutoFit style={{ marginTop: 8 }}>
              {entries.map(([k, v]) => (
                <DescriptionListGroup key={k}>
                  <DescriptionListTerm>{k}</DescriptionListTerm>
                  <DescriptionListDescription>
                    {Array.isArray(v) ? v.join(', ') : String(v)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              ))}
            </DescriptionList>
          </>
        )}
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
      </CardBody>
    </Card>
  );
};

const FeatureLinks: React.FC<{
  feature: SecurityFeatureSummary;
  routeName: string;
  routeNamespace: string;
}> = ({ feature, routeName, routeNamespace }) => {
  const links: React.ReactNode[] = [];
  if (feature.policyRef?.href) {
    links.push(
      <Link key="view-policy" to={feature.policyRef.href}>
        View {feature.policyRef.kind}
      </Link>,
    );
  }
  // Every subcard sends the user to the Effective policy stack tab for a
  // deeper dive on override resolution.
  links.push(
    <Link
      key="effective-stack"
      to={`/connectivity-link/httproutes/${routeNamespace}/${routeName}?tab=effective-policy-stack`}
    >
      Effective policy stack
    </Link>,
  );
  return (
    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
      {links.map((l, i) => (
        <FlexItem key={i}>{l}</FlexItem>
      ))}
    </Flex>
  );
};

const HeaderProbeActions: React.FC<{
  loading: boolean;
  configured: boolean;
  error?: string | null;
  onRun: () => void;
}> = ({ loading, configured, error, onRun }) => {
  if (!configured) {
    return (
      <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
        Install the dns-prober companion to probe live security response headers.
      </div>
    );
  }
  return (
    <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
      <FlexItem>
        <Button
          variant="secondary"
          onClick={onRun}
          isDisabled={loading}
          icon={loading ? <Spinner size="sm" /> : <Icon><RedoIcon /></Icon>}
          size="sm"
        >
          {loading ? 'Probing…' : 'Run check'}
        </Button>
      </FlexItem>
      {error && (
        <FlexItem>
          <span style={{ fontSize: 12, color: 'var(--pf-t--global--color--status--danger--default)' }}>
            {error}
          </span>
        </FlexItem>
      )}
    </Flex>
  );
};
