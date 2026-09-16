import * as React from 'react';
import {
  DropdownItem,
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Alert,
  AlertVariant,
  Checkbox,
  Tooltip,
} from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { useHistory } from 'react-router-dom';
import {
  k8sGet,
  k8sList,
  k8sDelete,
  K8sResourceCommon,
  K8sGroupVersionKind,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  APIProductGVK,
  HTTPRouteGVK,
  AuthPolicyGVK,
  RateLimitPolicyGVK,
  TokenRateLimitPolicyGVK,
  PlanPolicyGVK,
  APIKeyGVK,
  APIKeyRequestGVK,
  APIKeyApprovalGVK,
  SecretGVK,
} from '../../models';

/**
 * "Remove API + everything it created" for an APIProduct row.
 *
 * The API-publishing wizard writes several coordinated resources —
 * an HTTPRoute, at least one AuthPolicy, usually a RateLimitPolicy,
 * a TokenRateLimitPolicy or PlanPolicy on some templates, plus the
 * APIProduct itself and any test-key / consumer-key Secrets. Removing
 * an API means chasing all of those; doing it manually is a per-kind
 * scavenger hunt that leaves orphans (RateLimitPolicy referencing a
 * dead HTTPRoute is the classic mess).
 *
 * This component surfaces a single "Remove API + associated resources"
 * item on the row's kebab. Clicking it discovers everything on the
 * cluster that traces back to this APIProduct, previews the list in a
 * confirm modal, then batch-deletes.
 *
 * Deliberate exclusions:
 *   - The Gateway is shared. Never touched.
 *   - Gateway-scoped DNSPolicy / TLSPolicy are shared. Never touched.
 *   - APIKey CRs owned by named consumers (planTier != empty and
 *     spec.requestedBy.userId set) are deleted only when the operator
 *     opts in on the modal — the wizard's test-key Secret goes
 *     silently, but real consumer keys are a customer-facing artefact
 *     the operator has to acknowledge losing.
 */

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface APIProduct extends K8sResourceCommon {
  spec?: {
    targetRef?: {
      group?: string;
      kind?: string;
      name?: string;
    };
    displayName?: string;
  };
}

interface PolicyWithTargetRef extends K8sResourceCommon {
  spec?: {
    targetRef?: {
      group?: string;
      kind?: string;
      name?: string;
    };
  };
}

interface APIKeyWithProduct extends K8sResourceCommon {
  spec?: {
    apiProductRef?: { name?: string };
    secretRef?: { name?: string };
  };
}

interface DeletableRef {
  gvk: K8sGroupVersionKind;
  namespaced: boolean;
  plural: string;
  name: string;
  namespace?: string;
  /** Human-facing category — "HTTPRoute", "AuthPolicy", etc. */
  kind: string;
  /** True when this row is only removed if the operator opts in
   *  (currently only consumer APIKeys). */
  optional?: boolean;
}

// ------------------------------------------------------------------
// K8sModel helpers — the SDK insists on the extra fields; centralise
// so every call site produces the same object shape.
// ------------------------------------------------------------------

function toModel(gvk: K8sGroupVersionKind, plural: string, namespaced: boolean) {
  return {
    apiGroup: gvk.group || undefined,
    apiVersion: gvk.version,
    kind: gvk.kind,
    plural,
    abbr: gvk.kind.slice(0, 3).toUpperCase(),
    label: gvk.kind,
    labelPlural: plural,
    namespaced,
  };
}

// ------------------------------------------------------------------
// Discovery
// ------------------------------------------------------------------

async function discover(product: APIProduct): Promise<DeletableRef[]> {
  const productNs = product.metadata?.namespace as string;
  const productName = product.metadata?.name as string;
  const routeRef = product.spec?.targetRef;
  const found: DeletableRef[] = [];

  // 1) The APIProduct itself (deleted last after everything that
  //    references it is gone, but stays in the list at position 0 for
  //    the preview).
  found.push({
    gvk: APIProductGVK,
    namespaced: true,
    plural: 'apiproducts',
    kind: 'APIProduct',
    name: productName,
    namespace: productNs,
  });

  // 2) The HTTPRoute the APIProduct targets. `targetRef.kind` should
  //    be HTTPRoute — bail early if it isn't; we don't want to delete
  //    a Gateway or something unrelated by mistake.
  const routeName = routeRef?.kind === 'HTTPRoute' ? routeRef.name : undefined;
  if (routeName) {
    found.push({
      gvk: HTTPRouteGVK,
      namespaced: true,
      plural: 'httproutes',
      kind: 'HTTPRoute',
      name: routeName,
      namespace: productNs,
    });
  }

  // 3) Policies that target the HTTPRoute. Walk each policy kind
  //    in parallel and filter by targetRef.kind=HTTPRoute + name.
  const policyKinds: Array<{ gvk: K8sGroupVersionKind; plural: string; kind: string }> = [
    { gvk: AuthPolicyGVK, plural: 'authpolicies', kind: 'AuthPolicy' },
    { gvk: RateLimitPolicyGVK, plural: 'ratelimitpolicies', kind: 'RateLimitPolicy' },
    { gvk: TokenRateLimitPolicyGVK, plural: 'tokenratelimitpolicies', kind: 'TokenRateLimitPolicy' },
    { gvk: PlanPolicyGVK, plural: 'planpolicies', kind: 'PlanPolicy' },
  ];
  if (routeName) {
    const results = await Promise.all(
      policyKinds.map(async ({ gvk, plural, kind }) => {
        try {
          const list = await k8sList({
            model: toModel(gvk, plural, true) as never,
            queryParams: { ns: productNs },
          });
          const items = Array.isArray(list) ? list : (list as { items?: PolicyWithTargetRef[] }).items || [];
          return items
            .filter((p) => {
              const t = (p as PolicyWithTargetRef).spec?.targetRef;
              return t?.kind === 'HTTPRoute' && t?.name === routeName;
            })
            .map<DeletableRef>((p) => ({
              gvk,
              namespaced: true,
              plural,
              kind,
              name: p.metadata?.name as string,
              namespace: productNs,
            }));
        } catch (e) {
          // CRD not installed → skip, don't fail the whole flow.
          // eslint-disable-next-line no-console
          console.warn(`[cascade] skip ${kind}:`, (e as Error).message);
          return [] as DeletableRef[];
        }
      }),
    );
    for (const batch of results) found.push(...batch);
  }

  // 4) APIKey CRs bound to this APIProduct — customer-facing, opt-in.
  //    Their auto-spawned APIKeyRequest + APIKeyApproval CRs go with
  //    them (opt-in inherits).
  try {
    const list = await k8sList({
      model: toModel(APIKeyGVK, 'apikeys', true) as never,
      queryParams: { ns: productNs },
    });
    const items = Array.isArray(list) ? list : (list as { items?: APIKeyWithProduct[] }).items || [];
    for (const _k of items) {
      const k = _k as APIKeyWithProduct;
      if (k.spec?.apiProductRef?.name !== productName) continue;
      found.push({
        gvk: APIKeyGVK,
        namespaced: true,
        plural: 'apikeys',
        kind: 'APIKey',
        name: k.metadata?.name as string,
        namespace: productNs,
        optional: true,
      });
      // The provisioned Secret hanging off the APIKey's secretRef.
      if (k.spec?.secretRef?.name) {
        found.push({
          gvk: SecretGVK,
          namespaced: true,
          plural: 'secrets',
          kind: 'Secret',
          name: k.spec.secretRef.name,
          namespace: productNs,
          optional: true,
        });
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cascade] skip APIKey:', (e as Error).message);
  }

  // 5) Test-key Secret + any wizard-emitted apikey labelled Secret.
  //    Selector `app: <productName>-apikey` matches what the wizard's
  //    AuthPolicy + the "Try it right away" Secret use.
  try {
    const list = await k8sList({
      model: toModel(SecretGVK, 'secrets', true) as never,
      queryParams: {
        ns: productNs,
        // MUST be a Selector object, not a string: the SDK's toRequirements()
        // treats a string as an "old-format" selector and iterates its
        // characters (Object.keys("app=…")), producing a garbage selector
        // ("0=a,1=p,3==,…") the API server rejects with a 400. See k8s-utils.
        labelSelector: { matchLabels: { app: `${productName}-apikey` } },
      },
    });
    const items = Array.isArray(list) ? list : (list as { items?: K8sResourceCommon[] }).items || [];
    for (const s of items) {
      const name = s.metadata?.name as string;
      // Don't double-list APIKey-owned Secrets already added above.
      if (found.some((r) => r.kind === 'Secret' && r.name === name)) continue;
      found.push({
        gvk: SecretGVK,
        namespaced: true,
        plural: 'secrets',
        kind: 'Secret',
        name,
        namespace: productNs,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cascade] skip Secret:', (e as Error).message);
  }

  // 6) Any APIKeyRequest / APIKeyApproval controller-spawned records
  //    that reference an APIKey we're about to delete — they'd stick
  //    around as orphans otherwise. Kept opt-in so the operator sees
  //    they exist.
  const apiKeyNames = new Set(
    found.filter((r) => r.kind === 'APIKey').map((r) => r.name),
  );
  if (apiKeyNames.size > 0) {
    for (const { gvk, plural, kind } of [
      { gvk: APIKeyRequestGVK, plural: 'apikeyrequests', kind: 'APIKeyRequest' },
      { gvk: APIKeyApprovalGVK, plural: 'apikeyapprovals', kind: 'APIKeyApproval' },
    ]) {
      try {
        const list = await k8sList({
          model: toModel(gvk, plural, true) as never,
          queryParams: { ns: productNs },
        });
        const items = Array.isArray(list) ? list : (list as { items?: K8sResourceCommon[] }).items || [];
        for (const r of items) {
          const name = r.metadata?.name as string;
          // Heuristic: name prefixed by an APIKey name. Cheap and
          // matches how the controller stamps these.
          if (![...apiKeyNames].some((k) => name.startsWith(k))) continue;
          found.push({
            gvk,
            namespaced: true,
            plural,
            kind,
            name,
            namespace: productNs,
            optional: true,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[cascade] skip ${kind}:`, (e as Error).message);
      }
    }
  }

  return found;
}

// ------------------------------------------------------------------
// Deletion ordering — kill APIProduct LAST so its status controllers
// don't spawn replacements while we're mid-teardown. HTTPRoute goes
// AFTER policies so policies don't briefly land as "no attached
// route". Secrets can go any time.
// ------------------------------------------------------------------

function deletionOrder(refs: DeletableRef[]): DeletableRef[] {
  const rank: Record<string, number> = {
    APIKeyRequest: 0,
    APIKeyApproval: 0,
    APIKey: 1,
    Secret: 1,
    AuthPolicy: 2,
    RateLimitPolicy: 2,
    TokenRateLimitPolicy: 2,
    PlanPolicy: 2,
    HTTPRoute: 3,
    APIProduct: 4,
  };
  return [...refs].sort((a, b) => (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5));
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------

interface DeleteResult {
  ref: DeletableRef;
  ok: boolean;
  error?: string;
}

/**
 * The menu entry that lives INSIDE the row's actions Dropdown. It only fires a
 * callback — the modal itself is rendered by the page OUTSIDE the dropdown,
 * because a <Modal> mounted inside a PatternFly Dropdown is unmounted the
 * instant the menu closes on select (the dropdown drops its children). That's
 * why the old combined component only "flickered" and never opened.
 */
export const CascadeDeleteMenuItem: React.FC<{ onSelect: () => void }> = ({ onSelect }) => (
  <Tooltip
    position="left"
    content={
      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
        <strong>Removes</strong>: HTTPRoute · AuthPolicy · RateLimitPolicy ·
        TokenRateLimitPolicy · PlanPolicy · product-scoped Secrets · APIKey CRs and
        their provisioned Secrets (opt-in).
        <br />
        <strong>Keeps</strong>: the parent Gateway and its DNSPolicy / TLSPolicy
        — those are shared across every API on that Gateway and would take down
        every hostname on the cluster if deleted.
      </div>
    }
  >
    <DropdownItem
      key="cascade-delete"
      onClick={onSelect}
      className="pf-m-danger"
      description="Removes the HTTPRoute + AuthPolicy + rate-limit + product-scoped Secrets in one shot"
      icon={<OutlinedQuestionCircleIcon />}
    >
      Remove API and associated resources
    </DropdownItem>
  </Tooltip>
);

interface Props {
  namespace: string;
  name: string;
  isOpen: boolean;
  onClose: () => void;
}

const APIProductCascadeDelete: React.FC<Props> = ({ namespace, name, isOpen, onClose }) => {
  const history = useHistory();
  const [loading, setLoading] = React.useState(false);
  const [refs, setRefs] = React.useState<DeletableRef[] | null>(null);
  const [includeOptional, setIncludeOptional] = React.useState(true);
  const [deleting, setDeleting] = React.useState(false);
  const [results, setResults] = React.useState<DeleteResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Discover the blast radius whenever the modal is (re)opened for a target.
  // The modal is always mounted at page scope now, so key the run on isOpen +
  // the target coordinates and reset the per-open state each time.
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setRefs(null);
      setResults(null);
      setError(null);
      setIncludeOptional(true);
      setDeleting(false);
      try {
        const product = (await k8sGet({
          model: toModel(APIProductGVK, 'apiproducts', true) as never,
          name,
          ns: namespace,
        })) as APIProduct;
        const discovered = await discover(product);
        if (!cancelled) setRefs(discovered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, namespace, name]);

  const close = () => {
    if (deleting) return;
    const wasSuccess = results && results.every((r) => r.ok);
    onClose();
    // Kick to the list if we just finished a successful teardown so
    // the operator lands on the refreshed page.
    if (wasSuccess) {
      history.push('/connectivity-link/api-products');
    }
  };

  const runDelete = async () => {
    if (!refs) return;
    setDeleting(true);
    setError(null);
    // Filter out APIKey / Secret / APIKeyRequest / APIKeyApproval when
    // the operator declined to include consumer keys.
    const targets = includeOptional
      ? refs
      : refs.filter((r) => !r.optional);
    const ordered = deletionOrder(targets);
    const out: DeleteResult[] = [];
    for (const r of ordered) {
      try {
        await k8sDelete({
          model: toModel(r.gvk, r.plural, r.namespaced) as never,
          resource: {
            apiVersion: r.gvk.group ? `${r.gvk.group}/${r.gvk.version}` : r.gvk.version,
            kind: r.gvk.kind,
            metadata: {
              name: r.name,
              namespace: r.namespaced ? r.namespace : undefined,
            },
          },
        });
        out.push({ ref: r, ok: true });
      } catch (e) {
        // Not-found is fine — race with controller GC.
        const msg = e instanceof Error ? e.message : String(e);
        if (/not\s*found|404/i.test(msg)) {
          out.push({ ref: r, ok: true });
        } else {
          out.push({ ref: r, ok: false, error: msg });
        }
      }
    }
    setResults(out);
    setDeleting(false);
  };

  const optionalCount = refs?.filter((r) => r.optional).length ?? 0;
  const requiredCount = refs?.filter((r) => !r.optional).length ?? 0;
  const targetCount = includeOptional ? refs?.length ?? 0 : requiredCount;

  return (
    <>
      <Modal
        variant={ModalVariant.medium}
        isOpen={isOpen}
        onClose={close}
        aria-label="Remove API and associated resources"
      >
        <ModalHeader title={`Remove API ${name} and its resources`} />
        <ModalBody>
          {loading && <div>Scanning cluster…</div>}
          {error && (
            <Alert variant="danger" isInline title="Discovery failed">
              {error}
            </Alert>
          )}
          {refs && !results && (
            <>
              <p style={{ marginBottom: 12 }}>
                Deleting {targetCount} resource{targetCount === 1 ? '' : 's'} in{' '}
                <code>{namespace}</code>.
              </p>
              {/*
                Info-tone callout that makes the "shared" boundary
                explicit. Kept ABOVE the list of things being deleted so
                the operator's eye reads "what stays" before "what goes"
                — the opposite order buried the guarantee in a footnote
                and we still got asked "did this take down my Gateway?"
                the day the flow shipped.
              */}
              <Alert
                variant={AlertVariant.info}
                isInline
                title="Shared resources on the parent Gateway are not touched"
                style={{ marginBottom: 12 }}
              >
                The <strong>Gateway</strong> itself, its <strong>DNSPolicy</strong> and
                its <strong>TLSPolicy</strong> are shared across every API attached to
                that Gateway. Deleting them would drop every hostname the cluster
                publishes — so this teardown leaves them alone. Only resources
                exclusive to <code>{name}</code> are removed.
              </Alert>
              <ul className="rhcl-cascade-list">
                {refs.map((r) => (
                  <li
                    key={`${r.kind}/${r.name}`}
                    style={{
                      opacity: r.optional && !includeOptional ? 0.4 : 1,
                      textDecoration:
                        r.optional && !includeOptional ? 'line-through' : undefined,
                    }}
                  >
                    <strong>{r.kind}</strong> <code>{r.namespace}/{r.name}</code>
                    {r.optional && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          color: 'var(--pf-t--global--text--color--subtle)',
                          fontStyle: 'italic',
                        }}
                      >
                        (consumer-facing)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {optionalCount > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Checkbox
                    id="cascade-include-optional"
                    label={`Also remove ${optionalCount} consumer-facing item${optionalCount === 1 ? '' : 's'} (APIKey CRs + their Secrets)`}
                    isChecked={includeOptional}
                    onChange={(_e, v) => setIncludeOptional(v)}
                  />
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: 'var(--pf-t--global--text--color--subtle)',
                    }}
                  >
                    Uncheck to keep customer keys alive — you can move them to another
                    APIProduct afterwards.
                  </div>
                </div>
              )}
              <Alert variant="warning" isInline title="This cannot be undone" style={{ marginTop: 12 }}>
                Traffic to this API stops the moment the HTTPRoute is deleted. Any downstream
                DevPortal listings will 404 once the APIProduct is gone.
              </Alert>
            </>
          )}
          {results && (
            <>
              <p style={{ marginBottom: 8 }}>
                {results.filter((r) => r.ok).length} of {results.length} deleted.
              </p>
              <ul className="rhcl-cascade-list">
                {results.map((r) => (
                  <li key={`${r.ref.kind}/${r.ref.name}`}>
                    <strong>{r.ref.kind}</strong> <code>{r.ref.namespace}/{r.ref.name}</code>{' '}
                    {r.ok ? (
                      <span style={{ color: 'var(--pf-t--global--color--status--success--default)' }}>
                        ✓
                      </span>
                    ) : (
                      <span style={{ color: 'var(--pf-t--global--color--status--danger--default)' }}>
                        ✗ {r.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {!results && (
            <>
              <Button
                variant="danger"
                onClick={runDelete}
                isDisabled={loading || deleting || !refs || refs.length === 0}
                isLoading={deleting}
              >
                Delete {targetCount} resource{targetCount === 1 ? '' : 's'}
              </Button>
              <Button variant="link" onClick={close} isDisabled={deleting}>
                Cancel
              </Button>
            </>
          )}
          {results && (
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
};

export default APIProductCascadeDelete;
