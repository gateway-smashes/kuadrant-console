import * as React from 'react';
import { Card, CardBody, Grid, GridItem } from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  LockIcon,
  RedoIcon,
  CalendarAltIcon,
  ShieldAltIcon,
} from '@patternfly/react-icons';
import { STATUS_META } from '../dns/types';
import { OverallTlsStatus, TlsStepStatus } from './types';

/**
 * 5 KPI cards along the header — Overall / Certificate / Valid Until /
 * Auto Renewal / HTTPS Check. Same 5-across grid the mockup calls out;
 * on smaller screens they wrap. Each card's tone follows the same
 * status colours the flow diagram uses so the operator's eye reads the
 * two zones as one system.
 *
 * The `severity` on `validUntil` bypasses the normal
 * status→color mapping — 30 days healthy, 7-30 warning, <7 critical —
 * matching the "traffic-light on the certificate lifetime bar" pattern
 * cert-manager operators are used to.
 */

interface Props {
  overall: OverallTlsStatus;
}

const iconFor = (status: TlsStepStatus, size = 22): React.ReactNode => {
  const color = STATUS_META[status].color;
  const style = { color, fontSize: size };
  switch (STATUS_META[status].icon) {
    case 'check':
      return <CheckCircleIcon style={style} aria-hidden="true" />;
    case 'exclamation':
      return <ExclamationTriangleIcon style={style} aria-hidden="true" />;
    case 'x':
      return <ExclamationCircleIcon style={style} aria-hidden="true" />;
    case 'clock':
      return <ClockIcon style={style} aria-hidden="true" />;
    default:
      return <LockIcon style={style} aria-hidden="true" />;
  }
};

const KpiCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  primaryColor?: string;
}> = ({ title, icon, primary, secondary, primaryColor }) => (
  <Card className="rhcl-tls-kpi-card" isCompact>
    <CardBody>
      <div className="rhcl-tls-kpi-title">{title}</div>
      <div className="rhcl-tls-kpi-value">
        <span className="rhcl-tls-kpi-icon">{icon}</span>
        <span style={{ color: primaryColor }}>{primary}</span>
      </div>
      {secondary && <div className="rhcl-tls-kpi-secondary">{secondary}</div>}
    </CardBody>
  </Card>
);

const TLSStatusCards: React.FC<Props> = ({ overall }) => {
  const { overall: overallStatus, certificate, validUntil, autoRenewal, httpsCheck } = overall;
  const overallColor = STATUS_META[overallStatus].color;
  const certColor = STATUS_META[certificate.status].color;

  const validUntilColor =
    validUntil.severity === 'critical'
      ? STATUS_META.failing.color
      : validUntil.severity === 'warning'
      ? STATUS_META.warning.color
      : validUntil.severity === 'healthy'
      ? STATUS_META.healthy.color
      : STATUS_META.unknown.color;

  const validUntilPrimary = validUntil.isoDate
    ? new Date(validUntil.isoDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
  const validUntilSecondary =
    validUntil.daysRemaining == null
      ? undefined
      : validUntil.daysRemaining < 0
      ? `Expired ${Math.abs(validUntil.daysRemaining)} days ago`
      : `${validUntil.daysRemaining} days remaining`;

  return (
    <Grid hasGutter className="rhcl-tls-kpi-grid">
      <GridItem lg={2} md={4} sm={6}>
        <KpiCard
          title="Overall TLS Status"
          icon={iconFor(overallStatus)}
          primary={STATUS_META[overallStatus].label}
          secondary={
            overallStatus === 'failing'
              ? 'Requires attention'
              : overallStatus === 'warning'
              ? 'One or more warnings'
              : 'Everything looks good'
          }
          primaryColor={overallColor}
        />
      </GridItem>
      <GridItem lg={2} md={4} sm={6}>
        <KpiCard
          title="Certificate"
          icon={<ShieldAltIcon style={{ color: certColor, fontSize: 22 }} />}
          primary={certificate.label}
          secondary={certificate.subLabel}
          primaryColor={certColor}
        />
      </GridItem>
      <GridItem lg={3} md={4} sm={6}>
        <KpiCard
          title="Valid Until"
          icon={<CalendarAltIcon style={{ color: validUntilColor, fontSize: 22 }} />}
          primary={validUntilPrimary}
          secondary={validUntilSecondary}
          primaryColor={validUntilColor}
        />
      </GridItem>
      <GridItem lg={2} md={4} sm={6}>
        <KpiCard
          title="Auto Renewal"
          icon={<RedoIcon style={{ color: STATUS_META[autoRenewal.status].color, fontSize: 22 }} />}
          primary={autoRenewal.label}
          secondary={autoRenewal.subLabel}
          primaryColor={STATUS_META[autoRenewal.status].color}
        />
      </GridItem>
      <GridItem lg={3} md={4} sm={6}>
        <KpiCard
          title="HTTPS Check"
          icon={<LockIcon style={{ color: STATUS_META[httpsCheck.status].color, fontSize: 22 }} />}
          primary={httpsCheck.label}
          secondary={httpsCheck.subLabel || 'Live probe not run'}
          primaryColor={STATUS_META[httpsCheck.status].color}
        />
      </GridItem>
    </Grid>
  );
};

export default TLSStatusCards;
