import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Button,
  Label,
  Tooltip,
  Spinner,
} from '@patternfly/react-core';
import {
  LockIcon,
  ExternalLinkAltIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from '@patternfly/react-icons';
import { STATUS_META } from '../dns/types';
import { useTlsProber } from './useTlsProber';

/**
 * Live HTTPS validation card. The button calls the dns-prober
 * companion (same Quarkus service that runs the DNS probes — see
 * `dns-prober/.../TlsProbeResource.java`); the rows below get
 * populated from the live response.
 *
 * States:
 *   1. Prober not configured    → static "requires companion" rows +
 *                                 disabled button, same as before.
 *   2. Configured, no probe yet → measurement rows read "Not probed"
 *                                 until the check runs; button enabled.
 *   3. Probe in flight          → spinner in the header.
 *   4. Probe complete           → live rows, plus a `trusted` / cert
 *                                 validity chip.
 *   5. Probe errored            → error banner keeps the button
 *                                 enabled so retry is one click away.
 */

interface Props {
  hostname: string;
}

const StatusChip: React.FC<{
  ok: boolean;
  label: string;
}> = ({ ok, label }) => {
  const color = ok ? STATUS_META.healthy.color : STATUS_META.failing.color;
  const Icon = ok ? CheckCircleIcon : ExclamationCircleIcon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color }}>
      <Icon style={{ color }} /> {label}
    </span>
  );
};

const TLSHTTPSValidationCard: React.FC<Props> = ({ hostname }) => {
  const { configured, loading, error, result, runProbe } = useTlsProber(hostname);

  const endpoint = hostname ? `https://${hostname}` : '—';

  const headerRight = React.useMemo(() => {
    if (loading) {
      return (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <Spinner size="sm" /> probing…
        </span>
      );
    }
    if (result) {
      return (
        <Tooltip
          content={
            result.probedAt
              ? `Last probed ${new Date(result.probedAt).toLocaleTimeString()}`
              : 'Live handshake result'
          }
        >
          <Label
            color={result.handshake === 'ok' && result.trusted !== false ? 'green' : 'red'}
            isCompact
          >
            Live
          </Label>
        </Tooltip>
      );
    }
    if (!configured) {
      return (
        <Tooltip content="Live probe requires the dns-prober companion service (bundles the TLS endpoint too).">
          <Label color="grey" isCompact>not run</Label>
        </Tooltip>
      );
    }
    return null;
  }, [configured, loading, result]);

  // Row values. If we have a live result, use it; otherwise show "—"
  // (nothing measured yet). The header "not run" chip and the Run button
  // convey the un-probed state — we no longer fake predicted values here.
  const tlsVersion = result?.tlsVersion || '—';
  const cipher = result?.cipherSuite || '—';
  const httpStatus = result?.httpStatus
    ? `${result.httpStatus} ${result.httpStatusReason || ''}`.trim()
    : '—';
  const latency = result?.latencyMs != null ? `${result.latencyMs} ms` : '—';

  return (
    <Card aria-label="HTTPS validation" className="rhcl-tls-panel">
      <CardTitle>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LockIcon /> HTTPS Validation
          </span>
          {headerRight}
        </span>
      </CardTitle>
      <CardBody>
        <dl className="rhcl-tls-details-grid">
          <dt>HTTPS Endpoint</dt>
          <dd>
            {hostname ? (
              <a href={endpoint} target="_blank" rel="noopener noreferrer">
                {endpoint} <ExternalLinkAltIcon />
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt>TLS Handshake</dt>
          <dd>
            {result ? (
              <StatusChip
                ok={result.handshake === 'ok'}
                label={result.handshake === 'ok' ? 'Succeeded' : 'Failed'}
              />
            ) : (
              'Not probed'
            )}
          </dd>
          <dt>TLS Version</dt>
          <dd>{tlsVersion}</dd>
          <dt>Cipher Suite</dt>
          <dd>
            <code style={{ fontSize: 12 }}>{cipher}</code>
          </dd>
          <dt>Certificate Chain</dt>
          <dd>
            {result?.handshake === 'ok' ? (
              <span>
                {result.chainDepth ?? '?'} cert{(result.chainDepth ?? 0) === 1 ? '' : 's'} presented
                {result.cert?.expired && (
                  <>
                    {' · '}
                    <span style={{ color: STATUS_META.failing.color }}>expired</span>
                  </>
                )}
                {result.cert?.notYetValid && (
                  <>
                    {' · '}
                    <span style={{ color: STATUS_META.warning.color }}>not yet valid</span>
                  </>
                )}
              </span>
            ) : (
              'Not probed'
            )}
          </dd>
          <dt>Chain trusted</dt>
          <dd>
            {result?.trusted === true ? (
              <StatusChip ok={true} label="Yes (JDK default trust)" />
            ) : result?.trusted === false ? (
              <StatusChip ok={false} label="No — validation failed" />
            ) : (
              '—'
            )}
          </dd>
          <dt>HTTP Status</dt>
          <dd>{httpStatus}</dd>
          <dt>Latency</dt>
          <dd>{latency}</dd>
        </dl>

        {result?.cert && (
          <div style={{ marginTop: 12 }}>
            <div className="rhcl-tls-command-label">Certificate presented on the wire</div>
            <dl className="rhcl-tls-details-grid" style={{ marginTop: 4 }}>
              <dt>Subject</dt>
              <dd>
                <code style={{ fontSize: 12 }}>{result.cert.subject || '—'}</code>
              </dd>
              <dt>Issuer</dt>
              <dd>
                <code style={{ fontSize: 12 }}>{result.cert.issuer || '—'}</code>
              </dd>
              <dt>Valid from</dt>
              <dd>
                {result.cert.notBefore
                  ? new Date(result.cert.notBefore).toLocaleString()
                  : '—'}
              </dd>
              <dt>Valid until</dt>
              <dd>
                {result.cert.notAfter
                  ? new Date(result.cert.notAfter).toLocaleString()
                  : '—'}
              </dd>
              <dt>SANs</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>
                {result.cert.sans && result.cert.sans.length > 0
                  ? result.cert.sans.join(', ')
                  : '—'}
              </dd>
              <dt>Signature</dt>
              <dd>{result.cert.signatureAlgorithm || '—'}</dd>
            </dl>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--pf-t--global--color--status--danger--default) 8%, transparent)',
              border: '1px solid var(--pf-t--global--border--color--default)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ExclamationTriangleIcon
              style={{ color: STATUS_META.failing.color }}
              aria-hidden="true"
            />
            Prober error: {error}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {configured ? (
            <Button
              variant="primary"
              onClick={runProbe}
              isDisabled={loading || !hostname}
              isLoading={loading}
            >
              {result ? 'Re-run HTTPS Check' : 'Run HTTPS Check'}
            </Button>
          ) : (
            <Tooltip content="Requires the dns-prober companion service — same one that powers the DNS resolver preview.">
              <Button variant="primary" isDisabled>
                Run HTTPS Check
              </Button>
            </Tooltip>
          )}
        </div>
      </CardBody>
    </Card>
  );
};

export default TLSHTTPSValidationCard;
