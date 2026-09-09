import * as React from 'react';
import {
  K8sResourceCommon,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  GatewayGVK,
  TLSPolicyGVK,
  CertificateGVK,
  CertificateRequestGVK,
  OrderGVK,
  ChallengeGVK,
  IssuerGVK,
  ClusterIssuerGVK,
  SecretGVK,
} from '../../models';
import {
  TlsFlow,
  TlsStep,
  TlsStepStatus,
  TlsTimelineEvent,
  TlsCheck,
  TlsRecommendation,
  CertificateSummary,
  OverallTlsStatus,
} from './types';

/**
 * Joins the ~10 CRs on the cert-manager + Gateway + TLSPolicy pipeline
 * for one hostname into a single derived-state snapshot the TLS
 * Troubleshooting page renders from.
 *
 * Data flow, roughly (each step also correlates via ownerReferences):
 *
 *   Hostname (selected)
 *     └── Gateway.spec.listeners[].hostname === selectedHost
 *          └── listener.tls.certificateRefs[0] → Secret name
 *               └── Certificate.spec.secretName === secret name
 *                    └── CertificateRequest owned by Cert
 *                         └── Order owned by CR (ACME issuers only)
 *                              └── Challenge owned by Order
 *                              └── Issuer / ClusterIssuer by name
 *
 * TLSPolicy targets the Gateway. Its `Enforced` condition is the
 * authoritative signal for "the policy is doing something".
 */

interface StatusCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

interface WithConditions extends K8sResourceCommon {
  status?: {
    conditions?: StatusCondition[];
  };
}

interface GatewayResource extends WithConditions {
  spec?: {
    listeners?: Array<{
      name?: string;
      hostname?: string;
      port?: number;
      protocol?: string;
      tls?: {
        mode?: string;
        certificateRefs?: Array<{
          kind?: string;
          group?: string;
          name?: string;
          namespace?: string;
        }>;
      };
    }>;
  };
}

interface TLSPolicyResource extends WithConditions {
  spec?: {
    targetRef?: {
      group?: string;
      kind?: string;
      name?: string;
    };
    issuerRef?: {
      group?: string;
      kind?: string;
      name?: string;
    };
  };
}

interface CertificateResource extends WithConditions {
  spec?: {
    secretName?: string;
    dnsNames?: string[];
    issuerRef?: {
      kind?: string;
      name?: string;
    };
    privateKey?: {
      algorithm?: string;
      size?: number;
    };
    usages?: string[];
  };
  status?: {
    conditions?: StatusCondition[];
    notBefore?: string;
    notAfter?: string;
    renewalTime?: string;
    revision?: number;
  };
}

interface SecretResource extends K8sResourceCommon {
  type?: string;
  data?: Record<string, string>;
}

interface EventLike extends K8sResourceCommon {
  reason?: string;
  message?: string;
  type?: string;
  eventTime?: string;
  lastTimestamp?: string;
  firstTimestamp?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
}

const HOSTNAME_UNSET = '';

function findCondition(
  conds: StatusCondition[] | undefined,
  type: string,
): StatusCondition | undefined {
  return (conds || []).find((c) => c.type === type);
}

/** Ready condition may live at different truth values depending on the
 *  CR — sometimes Ready=True, sometimes just no Failed=True. Returns
 *  a `{ ok, message }` for downstream. */
function condOk(cond: StatusCondition | undefined): { ok: boolean; message?: string } | null {
  if (!cond) return null;
  return { ok: cond.status === 'True', message: cond.message || cond.reason };
}

/** True when this Gateway carries any listener that matches the
 *  requested hostname (exact or wildcard). */
function gatewayServesHostname(gw: GatewayResource, host: string): boolean {
  if (!host) return false;
  return (gw.spec?.listeners || []).some((l) => {
    if (!l.hostname) return false;
    if (l.hostname === host) return true;
    if (l.hostname.startsWith('*.')) {
      const suffix = l.hostname.slice(1); // ".apps.example.com"
      return host.endsWith(suffix);
    }
    return false;
  });
}

/** Days between two ISO timestamps. Negative when `then` is in the past. */
function daysUntil(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  return Math.floor((then - now) / 86_400_000);
}

/** Issuer label — the DNSPolicy hook has the same "Custom (secret)"
 *  fallback. Here we key off the issuerRef Kind + Name. */
function issuerLabel(ref?: { kind?: string; name?: string }): string {
  if (!ref?.name) return 'Not configured';
  const name = ref.name.toLowerCase();
  if (name.includes('letsencrypt-prod')) return "Let's Encrypt (production)";
  if (name.includes('letsencrypt-staging')) return "Let's Encrypt (staging)";
  if (name.includes('vault')) return `Vault (${ref.name})`;
  if (name.includes('acme')) return `ACME (${ref.name})`;
  return ref.name;
}

/**
 * Detects whether the resource type is ACME-based. When it isn't (Vault
 * PKI, self-signed, private CA), the Order / Challenge nodes render as
 * `skipped` — they'd otherwise stay `not-configured` forever and read
 * as a broken flow.
 */
function isAcmeIssuer(ref?: { kind?: string; name?: string }): boolean {
  if (!ref?.name) return false;
  const n = ref.name.toLowerCase();
  return n.includes('letsencrypt') || n.includes('acme');
}

/** cert-manager's Certificate condition types worth surfacing on the
 *  timeline. */
const CERT_INTERESTING = new Set(['Ready', 'Issuing']);
/** TLSPolicy conditions worth surfacing. */
const POLICY_INTERESTING = new Set(['Accepted', 'Enforced']);

interface CertificateExtraction {
  cert: CertificateResource | null;
  matchedBy: 'ownerRef' | 'dnsName' | 'secretName' | 'none';
}

/**
 * Find the Certificate that backs a given hostname / Gateway listener.
 * Tries in decreasing specificity:
 *
 *   1. Certificate.spec.secretName equals the Gateway listener's
 *      `certificateRefs[0].name` (tightest signal — cert-manager
 *      typically writes this Secret).
 *   2. Certificate.spec.dnsNames contains the hostname (or a matching
 *      wildcard).
 *   3. Certificate owned by the Gateway or by the TLSPolicy that
 *      targets it (ownerReferences).
 *   4. None — returns null and the page renders a "no Certificate for
 *      this hostname" empty state.
 */
function findCertificate(
  certs: CertificateResource[] | undefined,
  hostname: string,
  gateway: GatewayResource | null,
  tlsPolicy: TLSPolicyResource | null,
  secretNameFromGateway: string | undefined,
): CertificateExtraction {
  if (!certs || certs.length === 0) return { cert: null, matchedBy: 'none' };

  // 1. secretName match — highest fidelity.
  if (secretNameFromGateway) {
    const bySecret = certs.find((c) => c.spec?.secretName === secretNameFromGateway);
    if (bySecret) return { cert: bySecret, matchedBy: 'secretName' };
  }

  // 2. dnsNames match — handles wildcards.
  if (hostname) {
    const byDnsName = certs.find((c) =>
      (c.spec?.dnsNames || []).some((n) => {
        if (n === hostname) return true;
        if (n.startsWith('*.')) return hostname.endsWith(n.slice(1));
        return false;
      }),
    );
    if (byDnsName) return { cert: byDnsName, matchedBy: 'dnsName' };
  }

  // 3. ownerReferences — TLSPolicy usually spawns the Certificate.
  const ownerNames = new Set<string>();
  if (gateway?.metadata?.name) ownerNames.add(gateway.metadata.name);
  if (tlsPolicy?.metadata?.name) ownerNames.add(tlsPolicy.metadata.name);
  if (ownerNames.size > 0) {
    const byOwner = certs.find((c) =>
      (c.metadata?.ownerReferences || []).some((o) => ownerNames.has(o.name)),
    );
    if (byOwner) return { cert: byOwner, matchedBy: 'ownerRef' };
  }

  return { cert: null, matchedBy: 'none' };
}

/**
 * @param selectedHostname value picked in the header dropdown; when the
 *   list is empty this is `null` and the hook returns a "not
 *   configured" flow.
 */
export function useTlsTroubleshooting(selectedHostname: string | null): TlsFlow {
  const [gateways, gwLoaded] = useK8sWatchResource<GatewayResource[]>({
    groupVersionKind: GatewayGVK,
    isList: true,
  });
  const [tlsPolicies, tlsPoliciesLoaded] = useK8sWatchResource<TLSPolicyResource[]>({
    groupVersionKind: TLSPolicyGVK,
    isList: true,
  });
  const [certificates, certsLoaded] = useK8sWatchResource<CertificateResource[]>({
    groupVersionKind: CertificateGVK,
    isList: true,
  });
  const [certRequests, crLoaded] = useK8sWatchResource<WithConditions[]>({
    groupVersionKind: CertificateRequestGVK,
    isList: true,
  });
  const [orders, ordersLoaded] = useK8sWatchResource<WithConditions[]>({
    groupVersionKind: OrderGVK,
    isList: true,
  });
  const [challenges, challengesLoaded] = useK8sWatchResource<WithConditions[]>({
    groupVersionKind: ChallengeGVK,
    isList: true,
  });
  const [issuers, issuersLoaded] = useK8sWatchResource<WithConditions[]>({
    groupVersionKind: IssuerGVK,
    isList: true,
  });
  const [clusterIssuers, clusterIssuersLoaded] = useK8sWatchResource<WithConditions[]>({
    groupVersionKind: ClusterIssuerGVK,
    isList: true,
  });
  const [secrets, secretsLoaded] = useK8sWatchResource<SecretResource[]>({
    groupVersionKind: SecretGVK,
    isList: true,
  });
  const [events, eventsLoaded] = useK8sWatchResource<EventLike[]>({
    groupVersionKind: { version: 'v1', kind: 'Event' },
    isList: true,
  });

  return React.useMemo<TlsFlow>(() => {
    const loading =
      !gwLoaded ||
      !tlsPoliciesLoaded ||
      !certsLoaded ||
      !crLoaded ||
      !ordersLoaded ||
      !challengesLoaded ||
      !issuersLoaded ||
      !clusterIssuersLoaded ||
      !secretsLoaded ||
      !eventsLoaded;

    // Every hostname declared on any Gateway listener is a candidate
    // scope. Wildcard entries are surfaced as-is so an operator can
    // troubleshoot the whole apex.
    const hostnameSet = new Set<string>();
    for (const g of gateways || []) {
      for (const l of g.spec?.listeners || []) {
        if (l.hostname) hostnameSet.add(l.hostname);
      }
    }
    const hostnameOptions = [...hostnameSet].sort();
    const hostname = selectedHostname && hostnameSet.has(selectedHostname)
      ? selectedHostname
      : hostnameOptions[0] || HOSTNAME_UNSET;

    // Gateway + TLSPolicy for the selected hostname.
    const gateway = (gateways || []).find((g) => gatewayServesHostname(g, hostname)) || null;
    const gatewayName = gateway?.metadata?.name || '';
    const gatewayNs = gateway?.metadata?.namespace || '';

    const tlsPolicy =
      (tlsPolicies || []).find(
        (p) =>
          p.spec?.targetRef?.kind === 'Gateway' &&
          p.spec.targetRef.name === gatewayName,
      ) || null;

    // The listener that actually matches this host (for its
    // certificateRefs). A Kuadrant-managed Gateway typically declares
    // TWO listeners per hostname — one on :80 (HTTP) and one on :443
    // (HTTPS) — so picking `.find()` by hostname alone returns whatever
    // the operator wrote first, which is usually the HTTP one and
    // reads (incorrectly) as "listener is HTTP, not HTTPS" on the TLS
    // page. Prefer HTTPS.
    const hostnameMatches = (l: { hostname?: string }) => {
      if (!l.hostname) return false;
      if (l.hostname === hostname) return true;
      if (l.hostname.startsWith('*.')) return hostname.endsWith(l.hostname.slice(1));
      return false;
    };
    const httpsListener = gateway?.spec?.listeners?.find(
      (l) => l.protocol === 'HTTPS' && hostnameMatches(l),
    );
    const matchingListener = httpsListener || gateway?.spec?.listeners?.find(hostnameMatches);
    const secretRefFromGw = matchingListener?.tls?.certificateRefs?.[0]?.name;
    const secretNsFromGw =
      matchingListener?.tls?.certificateRefs?.[0]?.namespace || gatewayNs;

    // Certificate + downstream CRs.
    const { cert } = findCertificate(certificates, hostname, gateway, tlsPolicy, secretRefFromGw);

    const certReadyCond = findCondition(cert?.status?.conditions, 'Ready');
    const certIssuingCond = findCondition(cert?.status?.conditions, 'Issuing');
    const certReady = condOk(certReadyCond);
    const notAfter = cert?.status?.notAfter;
    const notBefore = cert?.status?.notBefore;
    const renewalTime = cert?.status?.renewalTime;
    const daysRemaining = daysUntil(notAfter);
    const expired = daysRemaining != null && daysRemaining < 0;

    // Owner-chain lookup for CR → Order → Challenge.
    const certRequest = cert
      ? (certRequests || [])
          .filter((cr) =>
            (cr.metadata?.ownerReferences || []).some(
              (o) => o.kind === 'Certificate' && o.name === cert.metadata?.name,
            ),
          )
          // pick the newest CR (highest resourceVersion, fallback to
          // creationTimestamp) since older ones are historical
          .sort(
            (a, b) =>
              new Date(b.metadata?.creationTimestamp || 0).getTime() -
              new Date(a.metadata?.creationTimestamp || 0).getTime(),
          )[0] || null
      : null;
    const order = certRequest
      ? (orders || []).find((o) =>
          (o.metadata?.ownerReferences || []).some(
            (r) => r.kind === 'CertificateRequest' && r.name === certRequest.metadata?.name,
          ),
        ) || null
      : null;
    const challenge = order
      ? (challenges || []).find((ch) =>
          (ch.metadata?.ownerReferences || []).some(
            (r) => r.kind === 'Order' && r.name === order.metadata?.name,
          ),
        ) || null
      : null;

    // Issuer resolution — TLSPolicy > Certificate spec.
    const issuerRef = tlsPolicy?.spec?.issuerRef || cert?.spec?.issuerRef;
    const issuerName = issuerRef?.name;
    const isClusterIssuer = issuerRef?.kind === 'ClusterIssuer';
    const issuer = issuerName
      ? isClusterIssuer
        ? (clusterIssuers || []).find((i) => i.metadata?.name === issuerName) || null
        : (issuers || []).find((i) => i.metadata?.name === issuerName) || null
      : null;
    const issuerReady = condOk(findCondition(issuer?.status?.conditions, 'Ready'));

    // Secret — Gateway lists it explicitly, or we fall back to
    // Certificate.spec.secretName.
    const secretName = secretRefFromGw || cert?.spec?.secretName;
    const secret = secretName
      ? (secrets || []).find(
          (s) =>
            s.metadata?.name === secretName &&
            s.metadata?.namespace === (secretNsFromGw || gatewayNs) &&
            s.type === 'kubernetes.io/tls',
        ) || null
      : null;
    const secretExists = !!secret;
    // The Secret should track the current cert. When the Certificate
    // was reissued but the Gateway is still serving the old one, the
    // Secret's `resourceVersion` won't have moved recently. cert-manager
    // stamps `cert-manager.io/certificate-name` on the Secret, and its
    // annotations sometimes carry the expected notAfter — we key off
    // annotation drift rather than trying to parse the cert bytes.
    const secretCertName = secret?.metadata?.annotations?.['cert-manager.io/certificate-name'];
    const secretMatchesCert = !!cert && secretCertName === cert.metadata?.name;

    // ---------------------------------------------------------------
    // STEPS
    // ---------------------------------------------------------------

    const steps: TlsStep[] = [];

    // 1. Hostname
    steps.push({
      id: 'hostname',
      title: 'Hostname',
      resourceName: hostname || undefined,
      status: hostname ? 'healthy' : 'not-configured',
      summary: hostname
        ? 'Hostname declared on a Gateway listener.'
        : 'No hostnames declared on any Gateway.',
      details: hostname
        ? [
            { label: 'Hostname', value: hostname },
            { label: 'Source', value: 'Gateway listener' },
          ]
        : [],
    });

    // 2. TLSPolicy
    const tlsAccepted = condOk(findCondition(tlsPolicy?.status?.conditions, 'Accepted'));
    const tlsEnforced = condOk(findCondition(tlsPolicy?.status?.conditions, 'Enforced'));
    steps.push({
      id: 'tlspolicy',
      title: 'TLSPolicy',
      resourceName: tlsPolicy?.metadata?.name,
      namespace: tlsPolicy?.metadata?.namespace,
      status: !tlsPolicy
        ? 'not-configured'
        : tlsAccepted?.ok && tlsEnforced?.ok
        ? 'healthy'
        : tlsAccepted?.ok
        ? 'warning'
        : 'failing',
      summary: !tlsPolicy
        ? 'No TLSPolicy is targeting this Gateway. Create one to publish certificates for its hostnames.'
        : tlsAccepted?.ok && tlsEnforced?.ok
        ? 'Policy is accepted and enforced by Kuadrant.'
        : tlsAccepted?.ok
        ? `Accepted but not enforced: ${tlsEnforced?.message || ''}`
        : `Not accepted: ${tlsAccepted?.message || ''}`,
      details: tlsPolicy
        ? [
            { label: 'Accepted', value: tlsAccepted?.ok ? 'True' : 'False' },
            { label: 'Enforced', value: tlsEnforced?.ok ? 'True' : 'False' },
            { label: 'IssuerRef', value: issuerName || '—' },
          ]
        : [],
      href: tlsPolicy
        ? `/k8s/ns/${tlsPolicy.metadata?.namespace}/kuadrant.io~v1~TLSPolicy/${tlsPolicy.metadata?.name}`
        : undefined,
    });

    // 3. Certificate
    steps.push({
      id: 'certificate',
      title: 'Certificate',
      resourceName: cert?.metadata?.name,
      namespace: cert?.metadata?.namespace,
      status: !cert
        ? 'not-configured'
        : expired
        ? 'failing'
        : certReady?.ok
        ? 'healthy'
        : certIssuingCond?.status === 'True'
        ? 'pending'
        : 'failing',
      summary: !cert
        ? 'No Certificate resource exists for this hostname.'
        : expired
        ? `Expired ${Math.abs(daysRemaining || 0)} days ago`
        : certReady?.ok
        ? `Valid for ${daysRemaining} more days`
        : certReady?.message || 'Not yet ready',
      details: cert
        ? [
            { label: 'Issuer', value: issuerLabel(cert.spec?.issuerRef) },
            { label: 'Valid until', value: notAfter ? new Date(notAfter).toLocaleDateString() : '—' },
            { label: 'SANs', value: (cert.spec?.dnsNames || []).slice(0, 2).join(', ') || '—' },
          ]
        : [],
      href: cert
        ? `/k8s/ns/${cert.metadata?.namespace}/cert-manager.io~v1~Certificate/${cert.metadata?.name}`
        : undefined,
    });

    // 4. CertificateRequest
    const crReady = condOk(findCondition(certRequest?.status?.conditions, 'Ready'));
    const crApproved = condOk(findCondition(certRequest?.status?.conditions, 'Approved'));
    steps.push({
      id: 'certrequest',
      title: 'CertificateRequest',
      resourceName: certRequest?.metadata?.name,
      namespace: certRequest?.metadata?.namespace,
      status: !certRequest
        ? cert ? 'skipped' : 'not-configured'
        : crReady?.ok
        ? 'healthy'
        : crApproved?.ok
        ? 'pending'
        : 'failing',
      summary: !certRequest
        ? 'No active CertificateRequest — cert is stable.'
        : crReady?.ok
        ? 'Signed and merged into the Secret.'
        : crApproved?.ok
        ? 'Approved, waiting for signing.'
        : crApproved?.message || 'Not approved',
      details: certRequest
        ? [
            { label: 'Approved', value: crApproved?.ok ? 'True' : 'False' },
            { label: 'Ready', value: crReady?.ok ? 'True' : 'False' },
          ]
        : [],
      href: certRequest
        ? `/k8s/ns/${certRequest.metadata?.namespace}/cert-manager.io~v1~CertificateRequest/${certRequest.metadata?.name}`
        : undefined,
    });

    // 5. ACME Challenge (skipped for non-ACME issuers)
    const acme = isAcmeIssuer(issuerRef) || !!challenge;
    const chReady = condOk(findCondition(challenge?.status?.conditions, 'Ready'));
    const chState = (challenge as { status?: { state?: string } } | null)?.status?.state;
    steps.push({
      id: 'challenge',
      title: 'ACME Challenge',
      resourceName: challenge?.metadata?.name,
      namespace: challenge?.metadata?.namespace,
      status: !acme
        ? 'skipped'
        : !challenge
        ? cert && certReady?.ok
          ? 'healthy'
          : 'not-configured'
        : chReady?.ok || chState === 'valid'
        ? 'healthy'
        : chState === 'pending' || chState === 'processing'
        ? 'pending'
        : 'failing',
      summary: !acme
        ? 'Issuer is not ACME-based — no challenge required.'
        : !challenge
        ? cert && certReady?.ok
          ? 'Historical challenge already validated.'
          : 'Waiting for challenge to be issued.'
        : chReady?.ok || chState === 'valid'
        ? 'Challenge validated.'
        : `State: ${chState || 'unknown'}`,
      details: challenge
        ? [
            { label: 'Type', value: (challenge as { spec?: { type?: string } }).spec?.type || '—' },
            { label: 'State', value: chState || '—' },
          ]
        : [],
      href: challenge
        ? `/k8s/ns/${challenge.metadata?.namespace}/acme.cert-manager.io~v1~Challenge/${challenge.metadata?.name}`
        : undefined,
    });

    // 6. Issuer
    steps.push({
      id: 'issuer',
      title: 'Issuer',
      resourceName: issuerName,
      namespace: isClusterIssuer ? undefined : issuer?.metadata?.namespace,
      status: !issuerRef
        ? 'not-configured'
        : !issuer
        ? 'warning'
        : issuerReady?.ok
        ? 'healthy'
        : 'failing',
      summary: !issuerRef
        ? 'TLSPolicy has no issuerRef.'
        : !issuer
        ? `Issuer "${issuerName}" not found on the cluster.`
        : issuerReady?.ok
        ? 'Ready to sign certificate requests.'
        : issuerReady?.message || 'Not ready',
      details: issuerRef
        ? [
            { label: 'Kind', value: issuerRef.kind || 'Issuer' },
            { label: 'Name', value: issuerName || '—' },
          ]
        : [],
      href: issuer
        ? isClusterIssuer
          ? `/k8s/cluster/cert-manager.io~v1~ClusterIssuer/${issuerName}`
          : `/k8s/ns/${issuer.metadata?.namespace}/cert-manager.io~v1~Issuer/${issuerName}`
        : undefined,
    });

    // 7. Secret
    steps.push({
      id: 'secret',
      title: 'Secret',
      resourceName: secretName,
      namespace: secretNsFromGw || gatewayNs,
      status: !secretName
        ? 'not-configured'
        : !secretExists
        ? 'failing'
        : cert && !secretMatchesCert
        ? 'warning'
        : 'healthy',
      summary: !secretName
        ? 'Gateway listener has no certificateRefs.'
        : !secretExists
        ? `Secret "${secretName}" does not exist in namespace "${secretNsFromGw || gatewayNs}".`
        : cert && !secretMatchesCert
        ? 'Secret is not managed by the resolved Certificate — Gateway may be serving a stale cert.'
        : 'Secret exists and is managed by cert-manager.',
      details: secretExists
        ? [
            { label: 'Type', value: 'kubernetes.io/tls' },
            {
              label: 'Managed by',
              value: secretCertName || 'unknown',
              muted: !secretCertName,
            },
          ]
        : [],
      href: secretExists
        ? `/k8s/ns/${secret.metadata?.namespace}/secrets/${secret.metadata?.name}`
        : undefined,
    });

    // 8. Gateway listener
    const gwProgrammed = condOk(findCondition(gateway?.status?.conditions, 'Programmed'));
    steps.push({
      id: 'gateway',
      title: 'Gateway Listener',
      resourceName: gatewayName ? `${gatewayName}:${matchingListener?.port || '?'}` : undefined,
      namespace: gatewayNs,
      status: !gateway
        ? 'not-configured'
        : !matchingListener
        ? 'warning'
        : matchingListener.protocol !== 'HTTPS'
        ? 'warning'
        : gwProgrammed?.ok
        ? 'healthy'
        : 'failing',
      summary: !gateway
        ? 'No Gateway matches this hostname.'
        : !matchingListener
        ? 'Gateway has no listener for this hostname.'
        : matchingListener.protocol !== 'HTTPS'
        ? `Listener is ${matchingListener.protocol}, not HTTPS.`
        : gwProgrammed?.ok
        ? 'Listener is programmed and terminating TLS.'
        : gwProgrammed?.message || 'Not programmed',
      details: matchingListener
        ? [
            { label: 'Protocol', value: matchingListener.protocol || '—' },
            { label: 'Port', value: String(matchingListener.port || '—') },
            { label: 'TLS mode', value: matchingListener.tls?.mode || 'Terminate' },
          ]
        : [],
      href: gateway
        ? `/connectivity-link/gateways/${gatewayNs}/${gatewayName}`
        : undefined,
    });

    // 9. HTTPS Ready — synthesized from the pipeline outcome.
    const httpsReady =
      !!gateway &&
      gwProgrammed?.ok === true &&
      secretExists &&
      certReady?.ok === true &&
      !expired;
    steps.push({
      id: 'https-ready',
      title: 'HTTPS Ready',
      resourceName: hostname ? `${hostname}:443` : undefined,
      status: httpsReady
        ? 'healthy'
        : expired
        ? 'failing'
        : !certReady?.ok
        ? 'pending'
        : 'warning',
      summary: httpsReady
        ? 'External clients should reach HTTPS successfully.'
        : expired
        ? 'Gateway is presenting an expired certificate — HTTPS handshake will surface a warning or fail.'
        : 'Some prerequisites are not yet met.',
      details: [
        { label: 'External check', value: 'not run' as string, muted: true },
        { label: 'TLS handshake', value: httpsReady ? 'expected OK' : 'expected failure', muted: !expired },
      ],
    });

    // ---------------------------------------------------------------
    // OVERALL STATUS
    // ---------------------------------------------------------------

    let overallStatus: TlsStepStatus = 'healthy';
    const badStatuses = steps
      .filter((s) => s.status !== 'skipped' && s.status !== 'not-configured')
      .map((s) => s.status);
    if (badStatuses.includes('failing')) overallStatus = 'failing';
    else if (badStatuses.includes('warning')) overallStatus = 'warning';
    else if (badStatuses.includes('pending')) overallStatus = 'pending';
    else if (badStatuses.every((s) => s === 'healthy')) overallStatus = 'healthy';
    else overallStatus = 'unknown';

    const overall: OverallTlsStatus = {
      overall: overallStatus,
      certificate: {
        status: expired
          ? 'failing'
          : certReady?.ok
          ? 'healthy'
          : certIssuingCond?.status === 'True'
          ? 'pending'
          : cert
          ? 'failing'
          : 'not-configured',
        label: expired
          ? 'Expired'
          : certReady?.ok
          ? 'Healthy'
          : certIssuingCond?.status === 'True'
          ? 'Renewing'
          : cert
          ? 'Failing'
          : 'Not configured',
        subLabel: expired
          ? `Expired ${Math.abs(daysRemaining || 0)} days ago`
          : certReady?.ok
          ? undefined
          : cert
          ? certReady?.message
          : undefined,
      },
      validUntil: {
        daysRemaining,
        isoDate: notAfter || null,
        severity: !notAfter
          ? 'unknown'
          : daysRemaining! < 0
          ? 'critical'
          : daysRemaining! < 7
          ? 'critical'
          : daysRemaining! < 30
          ? 'warning'
          : 'healthy',
      },
      autoRenewal: {
        status: !cert
          ? 'not-configured'
          : !renewalTime
          ? 'warning'
          : new Date(renewalTime).getTime() < Date.now()
          ? certIssuingCond?.status === 'True'
            ? 'pending'
            : 'failing'
          : 'healthy',
        label: !cert
          ? 'Unknown'
          : !renewalTime
          ? 'Not scheduled'
          : new Date(renewalTime).getTime() < Date.now()
          ? certIssuingCond?.status === 'True'
            ? 'Running'
            : 'Failed'
          : 'Scheduled',
        subLabel: renewalTime ? `at ${new Date(renewalTime).toLocaleDateString()}` : undefined,
      },
      httpsCheck: {
        status: httpsReady ? 'healthy' : 'failing',
        label: httpsReady ? 'Handshake expected OK' : 'Handshake likely failing',
        subLabel: undefined,
      },
    };

    // ---------------------------------------------------------------
    // TIMELINE — merge condition transitions across the whole chain.
    // ---------------------------------------------------------------

    const timeline: TlsTimelineEvent[] = [];
    const pushCond = (
      subject: string,
      name: string | undefined,
      conds: StatusCondition[] | undefined,
      allow: Set<string>,
    ) => {
      for (const c of conds || []) {
        if (!allow.has(c.type)) continue;
        if (!c.lastTransitionTime) continue;
        timeline.push({
          when: c.lastTransitionTime,
          title: `${subject}${name ? ` ${name}` : ''} — ${c.type} → ${c.status}`,
          detail: c.message || c.reason,
          status: c.status === 'True'
            ? c.type === 'Failed'
              ? 'failing'
              : 'healthy'
            : c.type === 'Ready' || c.type === 'Accepted' || c.type === 'Enforced'
            ? 'failing'
            : 'pending',
        });
      }
    };
    pushCond('TLSPolicy', tlsPolicy?.metadata?.name, tlsPolicy?.status?.conditions, POLICY_INTERESTING);
    pushCond('Certificate', cert?.metadata?.name, cert?.status?.conditions, CERT_INTERESTING);
    pushCond('CertificateRequest', certRequest?.metadata?.name, certRequest?.status?.conditions, new Set(['Ready', 'Approved']));
    if (order) {
      const oc = (order as { status?: { state?: string } }).status?.state;
      timeline.push({
        when: order.metadata?.creationTimestamp || new Date().toISOString(),
        title: `Order ${order.metadata?.name} state → ${oc || 'unknown'}`,
        status: oc === 'valid' ? 'healthy' : oc === 'invalid' ? 'failing' : 'pending',
      });
    }
    if (challenge) {
      const chs = (challenge as { status?: { state?: string } }).status?.state;
      timeline.push({
        when: challenge.metadata?.creationTimestamp || new Date().toISOString(),
        title: `Challenge ${challenge.metadata?.name} state → ${chs || 'unknown'}`,
        status: chs === 'valid' ? 'healthy' : chs === 'invalid' ? 'failing' : 'pending',
      });
    }

    // Fold in relevant k8s Events too — cert-manager, gateway-controller
    // and the console operator all emit useful Warning events during
    // failed rollouts.
    for (const e of events || []) {
      if (!e.involvedObject) continue;
      const target = e.involvedObject;
      const isRelated =
        (target.kind === 'Certificate' && target.name === cert?.metadata?.name) ||
        (target.kind === 'CertificateRequest' && target.name === certRequest?.metadata?.name) ||
        (target.kind === 'Order' && target.name === order?.metadata?.name) ||
        (target.kind === 'Challenge' && target.name === challenge?.metadata?.name) ||
        (target.kind === 'Gateway' && target.name === gateway?.metadata?.name);
      if (!isRelated) continue;
      const when = e.lastTimestamp || e.eventTime || e.firstTimestamp;
      if (!when) continue;
      timeline.push({
        when,
        title: `${target.kind} ${target.name}: ${e.reason || 'Event'}`,
        detail: e.message,
        status: e.type === 'Warning' ? 'failing' : 'healthy',
      });
    }

    timeline.sort((a, b) => a.when.localeCompare(b.when));
    // Trim to newest 10 so the sidebar stays scannable.
    const trimmedTimeline = timeline.slice(-10);

    // ---------------------------------------------------------------
    // CHECKS — deterministic assertions used by the Diagnostics table.
    // ---------------------------------------------------------------

    const checks: TlsCheck[] = [
      {
        id: 'tlspolicy-exists',
        label: 'TLSPolicy exists',
        status: tlsPolicy ? 'healthy' : 'failing',
        details: tlsPolicy?.metadata?.name,
        href: tlsPolicy
          ? `/k8s/ns/${tlsPolicy.metadata?.namespace}/kuadrant.io~v1~TLSPolicy/${tlsPolicy.metadata?.name}`
          : undefined,
      },
      {
        id: 'certificate-exists',
        label: 'Certificate exists',
        status: cert ? 'healthy' : 'failing',
        details: cert?.metadata?.name,
      },
      {
        id: 'certificate-ready',
        label: 'Certificate is ready',
        status: !cert
          ? 'skipped'
          : expired
          ? 'failing'
          : certReady?.ok
          ? 'healthy'
          : 'failing',
        details: expired ? `Expired ${Math.abs(daysRemaining || 0)} days ago` : certReady?.message,
      },
      {
        id: 'secret-exists',
        label: 'Secret exists',
        status: secretExists ? 'healthy' : 'failing',
        details: !secretExists && secretName ? `Secret "${secretName}" not found` : secretName,
      },
      {
        id: 'secret-valid',
        label: 'Secret is valid',
        status: !secretExists
          ? 'skipped'
          : cert && !secretMatchesCert
          ? 'failing'
          : 'healthy',
        details:
          cert && !secretMatchesCert
            ? 'Contains a certificate that is not managed by the resolved Certificate'
            : undefined,
      },
      {
        id: 'gateway-listener',
        label: 'Gateway listener configured',
        status: matchingListener ? 'healthy' : 'failing',
        details: matchingListener
          ? `${gatewayName}:${matchingListener.port}`
          : 'No listener matches the hostname',
      },
      {
        id: 'hostname-san',
        label: 'Hostname matches SAN',
        status: !cert
          ? 'skipped'
          : (cert.spec?.dnsNames || []).some(
              (n) => n === hostname || (n.startsWith('*.') && hostname.endsWith(n.slice(1))),
            )
          ? 'healthy'
          : 'failing',
        details: hostname,
      },
      {
        id: 'chain-valid',
        label: 'Certificate chain valid',
        status: !cert ? 'skipped' : expired ? 'failing' : certReady?.ok ? 'healthy' : 'pending',
        details: expired ? 'Certificate expired' : undefined,
      },
      {
        id: 'ocsp',
        label: 'OCSP status',
        status: 'skipped',
        details: 'Not evaluated (requires HTTPS probe)',
      },
      {
        id: 'renewal-scheduled',
        label: 'Auto renewal scheduled',
        status: !cert
          ? 'skipped'
          : renewalTime
          ? new Date(renewalTime).getTime() < Date.now()
            ? certIssuingCond?.status === 'True'
              ? 'pending'
              : 'warning'
            : 'healthy'
          : 'warning',
        details: renewalTime ? `at ${new Date(renewalTime).toLocaleString()}` : 'Not scheduled',
      },
      {
        id: 'https-reachable',
        label: 'HTTPS reachable',
        status: httpsReady ? 'healthy' : 'failing',
        details: httpsReady ? undefined : 'External probe not run in this build',
      },
    ];

    // ---------------------------------------------------------------
    // RECOMMENDATIONS — most useful first.
    // ---------------------------------------------------------------

    const recommendations: TlsRecommendation[] = [];
    if (expired) {
      recommendations.push({
        id: 'renew-cert',
        severity: 'critical',
        title: 'Certificate expired',
        detail: 'Renew immediately to restore HTTPS.',
        copyCommand: cert
          ? `oc annotate certificate ${cert.metadata?.name} -n ${cert.metadata?.namespace} cert-manager.io/issue-temporary-certificate=true --overwrite && oc annotate certificate ${cert.metadata?.name} -n ${cert.metadata?.namespace} cert-manager.io/rotate=true --overwrite`
          : undefined,
      });
    } else if (daysRemaining != null && daysRemaining < 7) {
      recommendations.push({
        id: 'expires-soon',
        severity: 'warning',
        title: `Certificate expires in ${daysRemaining} days`,
        detail: 'Renew before expiration.',
      });
    }
    if (!secretExists && secretName) {
      recommendations.push({
        id: 'missing-secret',
        severity: 'critical',
        title: 'TLS Secret not found',
        detail: `The Gateway listener references Secret "${secretName}" but it does not exist. cert-manager should create it once the Certificate is Ready.`,
      });
    }
    if (challenge && !chReady?.ok && chState !== 'valid') {
      recommendations.push({
        id: 'acme-challenge-failed',
        severity: 'warning',
        title: 'ACME DNS challenge pending',
        detail: 'Verify the TXT record has propagated. Some public resolvers take several minutes.',
      });
    }
    if (cert && !secretMatchesCert && secretExists) {
      recommendations.push({
        id: 'secret-drift',
        severity: 'warning',
        title: 'Secret not updated with new certificate',
        detail: 'The TLS Secret contains a cert that is not managed by the resolved Certificate.',
      });
    }
    if (
      hostname &&
      cert &&
      !(cert.spec?.dnsNames || []).some(
        (n) => n === hostname || (n.startsWith('*.') && hostname.endsWith(n.slice(1))),
      )
    ) {
      recommendations.push({
        id: 'hostname-missing-san',
        severity: 'warning',
        title: 'Hostname missing from SAN',
        detail: `Reissue the certificate including ${hostname}.`,
      });
    }
    // Listener isn't HTTPS (or is absent). The Root Cause panel already flags
    // this; without a matching recommendation the Smart Recommendations card
    // read "nothing to recommend" while Root Cause showed an actionable finding.
    // Keep the two surfaces in sync.
    if (gateway && matchingListener && matchingListener.protocol !== 'HTTPS') {
      recommendations.push({
        id: 'listener-not-https',
        severity: 'warning',
        title: 'Gateway listener is not HTTPS',
        detail: `The listener serving ${hostname || 'this hostname'} is ${
          matchingListener.protocol || 'not HTTPS'
        }. Add an HTTPS listener (and a TLSPolicy) so the gateway terminates TLS here.`,
      });
    } else if (gateway && !matchingListener) {
      recommendations.push({
        id: 'no-matching-listener',
        severity: 'warning',
        title: 'No Gateway listener for this hostname',
        detail: `Add an HTTPS listener to the Gateway for ${
          hostname || 'this hostname'
        } so it can terminate TLS.`,
      });
    }

    // ---------------------------------------------------------------
    // CERTIFICATE SUMMARY (for the Certificate Details card)
    // ---------------------------------------------------------------

    const certificate: CertificateSummary | null = cert
      ? {
          name: cert.metadata?.name || '',
          namespace: cert.metadata?.namespace || '',
          issuer: issuerLabel(cert.spec?.issuerRef),
          validFrom: notBefore,
          expiresAt: notAfter,
          renewalTime,
          secretName: cert.spec?.secretName,
          sans: cert.spec?.dnsNames,
          algorithm: cert.spec?.privateKey?.algorithm
            ? `${cert.spec.privateKey.algorithm} ${cert.spec.privateKey.size || ''}`.trim()
            : undefined,
          keyUsages: cert.spec?.usages,
        }
      : null;

    // ---------------------------------------------------------------
    // PRIMARY FAILURE — the first non-healthy step (skips
    // `skipped`/`not-configured` unless nothing else is wrong).
    // ---------------------------------------------------------------
    const primaryFailure =
      steps.find((s) => s.status === 'failing') ||
      steps.find((s) => s.status === 'warning') ||
      steps.find((s) => s.status === 'pending') ||
      null;

    // ---------------------------------------------------------------
    // EXTERNAL LINKS + HEADER LINKS
    // ---------------------------------------------------------------

    const externalLinks: TlsFlow['externalLinks'] = {
      grafana: undefined, // wired to plugin config in the page
      prometheus: '/monitoring/query-browser?query=' +
        encodeURIComponent(`probe_ssl_earliest_cert_expiry{host="${hostname}"}`),
      certManager: cert
        ? `/k8s/ns/${cert.metadata?.namespace}/cert-manager.io~v1~Certificate/${cert.metadata?.name}`
        : undefined,
      letsEncryptStatus: 'https://letsencrypt.status.io',
      dnsChecker: hostname ? `https://dnschecker.org/#TXT/_acme-challenge.${hostname}` : undefined,
    };

    const headerLinks: TlsFlow['headerLinks'] = {
      openCertificate: cert
        ? `/k8s/ns/${cert.metadata?.namespace}/cert-manager.io~v1~Certificate/${cert.metadata?.name}`
        : undefined,
      openGateway: gateway
        ? `/connectivity-link/gateways/${gatewayNs}/${gatewayName}`
        : undefined,
      openSecret: secretExists
        ? `/k8s/ns/${secret.metadata?.namespace}/secrets/${secret.metadata?.name}`
        : undefined,
    };

    // ---------------------------------------------------------------
    // needsTlsPolicy — when a Gateway advertises HTTPS listeners but
    // no TLSPolicy exists yet, we render the "create one to get
    // started" empty state on the page.
    // ---------------------------------------------------------------
    const anyHttpsListener = (gateways || []).some((g) =>
      (g.spec?.listeners || []).some((l) => l.protocol === 'HTTPS'),
    );
    const needsTlsPolicy =
      anyHttpsListener && (tlsPolicies || []).length === 0;

    return {
      hostname,
      hostnameOptions,
      overall,
      steps,
      timeline: trimmedTimeline,
      checks,
      recommendations,
      certificate,
      primaryFailure,
      loading,
      needsTlsPolicy,
      targetGateway: gateway ? { name: gatewayName, namespace: gatewayNs } : null,
      externalLinks,
      headerLinks,
    };
  }, [
    gateways,
    gwLoaded,
    tlsPolicies,
    tlsPoliciesLoaded,
    certificates,
    certsLoaded,
    certRequests,
    crLoaded,
    orders,
    ordersLoaded,
    challenges,
    challengesLoaded,
    issuers,
    issuersLoaded,
    clusterIssuers,
    clusterIssuersLoaded,
    secrets,
    secretsLoaded,
    events,
    eventsLoaded,
    selectedHostname,
  ]);
}
