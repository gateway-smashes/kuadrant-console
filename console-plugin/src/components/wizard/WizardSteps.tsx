import * as React from 'react';
import {
  Alert,
  Button,
  ExpandableSection,
  Label,
  Radio,
  Switch,
  Modal as PfModal,
  ModalVariant as PfModalVariant,
  ModalHeader as PfModalHeader,
  ModalBody as PfModalBody,
  ModalFooter as PfModalFooter,
} from '@patternfly/react-core';
import {
  PlusCircleIcon,
  MinusCircleIcon,
  TrashIcon,
  CheckCircleIcon,
  BanIcon,
  LockIcon,
  InfoCircleIcon,
  UploadIcon,
} from '@patternfly/react-icons';
import { load as yamlLoad } from 'js-yaml';
import { BulletTone } from './wizardTypes';
import {
  K8sResourceCommon,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { GatewayGVK, ServiceGVK, NamespaceGVK } from '../../models';
import {
  WizardState,
  TEMPLATES,
  TemplateDef,
  RouteRule,
  newRouteId,
  BackendPoolEntry,
  newBackendId,
  AuthMode,
  defaultState,
  RATE_LIMIT_SCOPES,
  RateLimitScope,
} from './wizardTypes';
import { ArchDiagram, StepHeader, Field } from './WizardShared';

type Patch = (p: Partial<WizardState>) => void;

// ---------------------------------------------------------------------------
// Step 1 — Template
// ---------------------------------------------------------------------------
/**
 * Bullet icon selector for the template-card list. Splitting this out
 * of the map keeps the JSX in TemplateStep readable and makes the
 * mapping "tone → icon + color" easy to tweak in one place. Sizes and
 * colors are inline (not CSS classes) so the visual weight stays the
 * same the moment the file is loaded, without a paint flash.
 */
const BulletIcon: React.FC<{ tone: BulletTone }> = ({ tone }) => {
  const style: React.CSSProperties = { fontSize: 11 };
  switch (tone) {
    case 'no':
      // Muted red-orange — the same tone the operational health cards
      // use for "not enforced", so opt-outs read consistently across the
      // plugin (opt-out here ≠ error, but the semantic weight matches).
      return <BanIcon style={{ ...style, color: 'var(--pf-t--global--color--status--danger--default)' }} />;
    case 'internal':
      // A padlock reads as "closed for the outside world" without any
      // negative charge — "Internal only" isn't an opt-out, it's a
      // deliberate scope.
      return <LockIcon style={{ ...style, color: 'var(--pf-t--global--color--status--info--default)' }} />;
    case 'info':
      // Neutral notes ("All steps editable") — no positive/negative
      // charge, just context.
      return <InfoCircleIcon style={{ ...style, color: 'var(--pf-t--global--color--nonstatus--gray--default)' }} />;
    case 'yes':
    default:
      return <CheckCircleIcon style={{ ...style, color: 'var(--pf-t--global--color--brand--default)' }} />;
  }
};

export const TemplateStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => {
  const pick = (t: TemplateDef) => {
    // Re-picking resets prior template's choices: apply on top of a
    // fresh default so switching Public→Internal doesn't leave DNS on.
    const base = defaultState();
    patch({ ...base, ...t.patch, template: t.id, namespace: state.namespace });
  };
  const [showImport, setShowImport] = React.useState(false);
  return (
    <>
      <StepHeader
        title="What kind of API are you publishing?"
        what="Start from a scenario — the wizard pre-fills security, policies and discoverability. You can change everything later."
      />
      {/* Bootstrap-from-OpenAPI escape hatch: an operator who already
          owns the API spec shouldn't have to re-type displayName /
          version / routes into the wizard. The importer parses the
          spec once and patches the wizard state; the user then continues
          from Backend as usual. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button variant="link" icon={<UploadIcon />} onClick={() => setShowImport(true)}>
          Import from OpenAPI spec
        </Button>
      </div>
      <div className="rhcl-wiz-template-grid">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rhcl-wiz-template-card${state.template === t.id ? ' is-selected' : ''}`}
            onClick={() => pick(t)}
          >
            <div className="rhcl-wiz-template-title">{t.title}</div>
            <ul className="rhcl-wiz-template-bullets">
              {t.bullets.map((b) => (
                <li key={b.text}>
                  <BulletIcon tone={b.tone || 'yes'} /> {b.text}
                </li>
              ))}
            </ul>
            <div className="rhcl-wiz-template-audience">{t.audience}</div>
            <div className="rhcl-wiz-template-outcome">{t.outcome}</div>
          </button>
        ))}
      </div>
      <OpenApiImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onApply={(p) => {
          // Preserve namespace/template selection when importing on top;
          // spec-derived fields overwrite everything else.
          patch({ ...defaultState(), ...p, namespace: state.namespace });
          setShowImport(false);
        }}
      />
    </>
  );
};

/**
 * OpenAPI 3 → WizardState bootstrapper. Accepts JSON or YAML pasted
 * into a textarea; parses defensively (no crash if the spec is missing
 * fields we care about); emits a Partial<WizardState> patch the caller
 * merges. What we pull out:
 *
 *   info.title       → displayName + serviceName (kebab-case)
 *   info.version     → version
 *   info.description → description
 *   servers[0].url   → hostname (URL host part) and openApiUrl base
 *   paths + methods  → routes[] (one per (path, method) pair)
 *   tags             → tags[]
 *
 * We do NOT try to derive Kubernetes Service/port from `servers` — that
 * URL is what a public consumer would call, not the in-cluster service
 * name. The user still fills BackendStep by hand.
 */
const OpenApiImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onApply: (patch: Partial<WizardState>) => void;
}> = ({ isOpen, onClose, onApply }) => {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    setText('');
    setError(null);
  }, [isOpen]);

  const apply = () => {
    setError(null);
    if (!text.trim()) {
      setError('Paste an OpenAPI 3 spec (JSON or YAML).');
      return;
    }
    let parsed: unknown;
    try {
      parsed = yamlLoad(text);
    } catch (e) {
      setError(`Parse error: ${(e as Error).message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setError('The spec must be a JSON or YAML object.');
      return;
    }
    const spec = parsed as OpenApiSpec;
    if (!spec.openapi && !spec.swagger) {
      setError('Missing `openapi` (or `swagger`) version field — is this an OpenAPI document?');
      return;
    }
    const info = spec.info || {};
    const title = info.title || '';
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const serverUrl = spec.servers?.[0]?.url || '';
    let hostname = '';
    try {
      // Servers can be URL templates ({basePath}); fall back gracefully.
      hostname = serverUrl ? new URL(serverUrl.replace(/\{[^}]+\}/g, '')).hostname : '';
    } catch {
      hostname = '';
    }
    const paths = spec.paths || {};
    const rules: RouteRule[] = [];
    for (const [path, item] of Object.entries(paths)) {
      if (!item || typeof item !== 'object') continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
        if ((item as Record<string, unknown>)[method]) {
          rules.push({
            id: newRouteId(),
            method: method.toUpperCase(),
            path,
            matchType: path.includes('{') ? 'PathPrefix' : 'Exact',
          });
        }
      }
      // Cap the surface — importing 200-endpoint specs verbatim would
      // slow the wizard's re-render and rarely reflects what the
      // operator actually wants to expose right now.
      if (rules.length >= 25) break;
    }
    // NOTE: the OpenAPI slug used to seed `serviceName` on the state,
    // back when the wizard tracked a single backend at the top level.
    // With the multi-backend refactor the operator picks Services from
    // a table in step 2 — we can't guess the K8s Service name from an
    // OpenAPI title reliably. Slug is dropped from the seed.
    void slug;
    onApply({
      displayName: title,
      description: info.description || '',
      version: info.version || 'v1',
      hostname,
      openApiUrl: '',
      tags: Array.isArray(spec.tags)
        ? spec.tags.map((t) => t.name).filter((n): n is string => !!n)
        : [],
      routes: rules.length > 0 ? rules : [
        { id: newRouteId(), method: 'ANY', path: '/', matchType: 'PathPrefix' },
      ],
    });
  };

  return (
    <PfModal
      variant={PfModalVariant.large}
      isOpen={isOpen}
      onClose={onClose}
      aria-label="Import OpenAPI spec"
    >
      <PfModalHeader title="Import from OpenAPI spec" />
      <PfModalBody>
        <p style={{ fontSize: 13, marginBottom: 8, color: 'var(--pf-t--global--color--nonstatus--gray--default)' }}>
          Paste an OpenAPI 3 document (JSON or YAML). The wizard fills in display name, version,
          hostname, tags, and routes derived from the paths.
        </p>
        <textarea
          className="rhcl-wiz-input"
          style={{
            width: '100%',
            minHeight: 300,
            fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
          }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\nservers:\n  - url: https://api.example.com\npaths:\n  /widgets:\n    get: { ... }'}
          spellCheck={false}
        />
        {error && (
          <Alert variant="danger" isInline title="Import failed" style={{ marginTop: 8 }}>
            {error}
          </Alert>
        )}
      </PfModalBody>
      <PfModalFooter>
        <Button variant="primary" onClick={apply}>Apply</Button>
        <Button variant="link" onClick={onClose}>Cancel</Button>
      </PfModalFooter>
    </PfModal>
  );
};

/** Minimal type covering the fields we actually read from the spec. */
interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    description?: string;
    version?: string;
  };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, unknown>;
  tags?: Array<{ name?: string }>;
}

// ---------------------------------------------------------------------------
// Step 2 — Backends (multi-backend pool)
// ---------------------------------------------------------------------------
//
// The pool supports three shapes:
//
//   1. Single backend  → HTTPRoute with one backendRef (no weight rendered).
//   2. Weighted split  → HTTPRoute rule with multiple backendRefs and
//                        per-entry `weight` (canary / blue-green).
//   3. Cross-namespace → same as above, plus a ReferenceGrant per remote
//                        namespace so Gateway API lets the HTTPRoute
//                        reference the remote Service.
//
// Per-path routing (a rule pinned to a subset of the pool) is layered
// on top by the Routes step below via `RouteRule.backendIds`.
interface ServiceResource extends K8sResourceCommon {
  spec?: { ports?: { port: number; name?: string; protocol?: string }[] };
}

// One backend row. It owns a Services watch SCOPED TO ITS OWN NAMESPACE, and
// skips the watch entirely (null) until a namespace is chosen. This replaces a
// previous cluster-wide Services list watch that loaded every Service in every
// namespace — on a real cluster that hung the whole wizard (unresponsive page,
// dropdowns that never populated), blocking the flow at this step.
const BackendRow: React.FC<{
  b: BackendPoolEntry;
  namespaces: string[];
  namespacesLoaded: boolean;
  isMulti: boolean;
  primaryNs: string;
  onUpdate: (id: string, upd: Partial<BackendPoolEntry>) => void;
  onRemove: (id: string) => void;
}> = ({ b, namespaces, namespacesLoaded, isMulti, primaryNs, onUpdate, onRemove }) => {
  const [services] = useK8sWatchResource<ServiceResource[]>(
    b.namespace
      ? { groupVersionKind: ServiceGVK, isList: true, namespace: b.namespace }
      : null,
  );
  const svcs = services || [];
  const svc = svcs.find((s) => s.metadata?.name === b.name);
  const ports = svc?.spec?.ports || [];
  const isRemote = !!primaryNs && !!b.namespace && b.namespace !== primaryNs;
  return (
    <div className="rhcl-wiz-backend-row">
      <select
        className="rhcl-wiz-select"
        value={b.namespace}
        onChange={(e) => onUpdate(b.id, { namespace: e.target.value, name: '', port: null })}
      >
        <option value="">{namespacesLoaded ? 'Select…' : 'Loading…'}</option>
        {namespaces.map((ns) => (
          <option key={ns} value={ns}>
            {ns}
          </option>
        ))}
      </select>

      <select
        className="rhcl-wiz-select"
        value={b.name}
        disabled={!b.namespace}
        onChange={(e) => {
          const s = svcs.find((x) => x.metadata?.name === e.target.value);
          const firstPort = s?.spec?.ports?.[0]?.port ?? null;
          onUpdate(b.id, { name: e.target.value, port: firstPort });
        }}
      >
        <option value="">Select…</option>
        {svcs.map((s) => (
          <option key={s.metadata?.name} value={s.metadata?.name}>
            {s.metadata?.name}
          </option>
        ))}
      </select>

      <select
        className="rhcl-wiz-select"
        value={b.port ?? ''}
        disabled={!b.name}
        onChange={(e) => onUpdate(b.id, { port: Number(e.target.value) })}
      >
        <option value="">—</option>
        {ports.map((p) => (
          <option key={p.port} value={p.port}>
            {p.port}
            {p.name ? ` (${p.name})` : ''}
          </option>
        ))}
      </select>

      <select
        className="rhcl-wiz-select"
        value={b.protocol}
        onChange={(e) =>
          onUpdate(b.id, { protocol: e.target.value as BackendPoolEntry['protocol'] })
        }
      >
        <option value="HTTP">HTTP</option>
        <option value="HTTPS">HTTPS</option>
        <option value="GRPC">gRPC</option>
      </select>

      <input
        type="number"
        min={1}
        max={1000}
        className="rhcl-wiz-input"
        value={b.weight}
        onChange={(e) => onUpdate(b.id, { weight: Math.max(1, Number(e.target.value) || 1) })}
        disabled={!isMulti}
        title={
          isMulti
            ? 'Relative weight in the traffic split'
            : 'Weights only apply once you add a second backend'
        }
      />

      <button
        className="rhcl-wiz-icon-btn"
        onClick={() => onRemove(b.id)}
        aria-label={`Remove ${b.namespace}/${b.name}`}
        title="Remove backend"
      >
        <MinusCircleIcon />
      </button>

      {isRemote && (
        <div className="rhcl-wiz-backend-note">
          Cross-namespace — a ReferenceGrant is generated in
          <code> {b.namespace}</code>.
        </div>
      )}
    </div>
  );
};

export const BackendStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => {
  // Namespaces feed the per-row namespace picker. Cluster-scoped and small
  // (unlike a cluster-wide Services list) — the operator picks a namespace and
  // each row then watches only that namespace's Services.
  const [namespaceObjs, namespacesLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: NamespaceGVK,
    isList: true,
  });

  const namespaces = React.useMemo(() => {
    return (namespaceObjs || [])
      .map((n) => n.metadata?.name)
      .filter((n): n is string => !!n && !n.startsWith('openshift') && !n.startsWith('kube-'))
      .sort();
  }, [namespaceObjs]);

  const addBackend = () => {
    const entry: BackendPoolEntry = {
      id: newBackendId(),
      namespace: state.backends[0]?.namespace || '',
      name: '',
      port: null,
      protocol: state.backends[0]?.protocol || 'HTTP',
      weight: 100,
    };
    const next = [...state.backends, entry];
    patch({ backends: next, namespace: next[0].namespace });
  };
  const removeBackend = (id: string) => {
    const next = state.backends.filter((b) => b.id !== id);
    patch({
      backends: next,
      namespace: next[0]?.namespace || '',
      // Purge orphaned overrides on any route.
      routes: state.routes.map((r) =>
        r.backendIds && r.backendIds.length > 0
          ? { ...r, backendIds: r.backendIds.filter((bid) => next.some((b) => b.id === bid)) }
          : r,
      ),
    });
  };
  const updateBackend = (id: string, upd: Partial<BackendPoolEntry>) => {
    const next = state.backends.map((b) => (b.id === id ? { ...b, ...upd } : b));
    patch({ backends: next, namespace: next[0]?.namespace || '' });
  };

  // Cross-NS detection for the operator note. The HTTPRoute is placed
  // in the first backend's namespace; anything else is remote.
  const primaryNs = state.backends[0]?.namespace || '';
  const remoteNamespaces = React.useMemo(() => {
    const s = new Set<string>();
    for (const b of state.backends) {
      if (b.namespace && b.namespace !== primaryNs) s.add(b.namespace);
    }
    return [...s];
  }, [state.backends, primaryNs]);

  const weightSum = state.backends.reduce((acc, b) => acc + (b.weight || 0), 0);
  const isMulti = state.backends.length > 1;

  return (
    <>
      <StepHeader
        title="Where is your API running?"
        what={
          isMulti
            ? 'Add multiple Services to split traffic (canary / blue-green) or to fan out across namespaces. The HTTPRoute is placed in the first backend’s namespace; a ReferenceGrant is generated automatically for every remote namespace.'
            : 'Select the Kubernetes Service that already exposes your application. Add more to split traffic across versions or namespaces.'
        }
      />
      <div className="rhcl-wiz-two-col">
        <div>
          <div className="rhcl-wiz-backend-table">
            <div className="rhcl-wiz-backend-head">
              <span>Namespace</span>
              <span>Service</span>
              <span>Port</span>
              <span>Protocol</span>
              <span>Weight</span>
              <span aria-label="Remove" />
            </div>

            {state.backends.length === 0 && (
              <div className="rhcl-wiz-backend-empty">
                No backends yet — add your first Service.
              </div>
            )}

            {state.backends.map((b) => (
              <BackendRow
                key={b.id}
                b={b}
                namespaces={namespaces}
                namespacesLoaded={namespacesLoaded}
                isMulti={isMulti}
                primaryNs={primaryNs}
                onUpdate={updateBackend}
                onRemove={removeBackend}
              />
            ))}

            <button className="rhcl-wiz-add-btn" onClick={addBackend}>
              <PlusCircleIcon /> Add backend
            </button>

            {isMulti && weightSum > 0 && (
              <div className="rhcl-wiz-backend-split">
                Split preview:{' '}
                {state.backends.map((b, i) => {
                  const pct = Math.round((b.weight / weightSum) * 100);
                  return (
                    <span key={b.id}>
                      {i > 0 ? ' · ' : ''}
                      <strong>{b.name || 'unnamed'}</strong> {pct}%
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {remoteNamespaces.length > 0 && (
            <div className="rhcl-wiz-validation info">
              Cross-namespace backends detected in{' '}
              {remoteNamespaces.map((n) => (
                <code key={n}> {n} </code>
              ))}
              — Kuadrant needs a{' '}
              <code>ReferenceGrant</code> in each. The wizard will create them.
            </div>
          )}

          {state.backends.length > 0 && state.backends.every((b) => b.name && b.port) && (
            <div className="rhcl-wiz-validation ok">
              <CheckCircleIcon /> {state.backends.length === 1
                ? `Backend found: ${state.backends[0].namespace}/${state.backends[0].name}:${state.backends[0].port}`
                : `${state.backends.length} backends ready`}
            </div>
          )}
        </div>
        <ArchDiagram state={state} />
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Step 3 — Gateway
// ---------------------------------------------------------------------------
interface GatewayWithListeners extends K8sResourceCommon {
  spec?: {
    listeners?: Array<{
      name?: string;
      hostname?: string;
      port?: number;
      protocol?: string;
    }>;
  };
}
export const GatewayStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => {
  const [gateways, gwLoaded] = useK8sWatchResource<GatewayWithListeners[]>({
    groupVersionKind: GatewayGVK,
    isList: true,
  });

  // Hostnames the selected existing Gateway actually advertises.
  // Empty when we don't have a Gateway selected or when its listeners
  // don't declare hostnames (wildcard mode).
  const selectedGateway = React.useMemo(() => {
    if (!state.useExistingGateway || !state.existingGatewayName) return null;
    return (gateways || []).find(
      (g) =>
        g.metadata?.name === state.existingGatewayName &&
        g.metadata?.namespace === state.existingGatewayNamespace,
    ) || null;
  }, [gateways, state.useExistingGateway, state.existingGatewayName, state.existingGatewayNamespace]);
  const gatewayHostnames = React.useMemo(() => {
    if (!selectedGateway) return [] as string[];
    const set = new Set<string>();
    for (const l of selectedGateway.spec?.listeners || []) {
      if (l.hostname) set.add(l.hostname);
    }
    return [...set].sort();
  }, [selectedGateway]);
  const hostnameMatchesGateway = React.useMemo(() => {
    if (!state.hostname) return null;
    if (gatewayHostnames.length === 0) return null;
    return gatewayHostnames.some((h) => {
      if (h === state.hostname) return true;
      if (h.startsWith('*.') && state.hostname.endsWith(h.slice(1))) return true;
      return false;
    });
  }, [gatewayHostnames, state.hostname]);
  return (
    <>
      <StepHeader
        title="How will traffic enter your cluster?"
        what="A Gateway is the shared front door — most APIs attach to an existing one. Create a dedicated Gateway only when you need isolated listeners or a different hostname domain."
      />
      <div className="rhcl-wiz-two-col">
        <div>
          <div className="rhcl-wiz-radio-row">
            <Radio
              id="gw-existing"
              name="gw-mode"
              label="Attach to an existing Gateway (recommended)"
              isChecked={state.useExistingGateway}
              onChange={() => patch({ useExistingGateway: true })}
            />
            <Radio
              id="gw-new"
              name="gw-mode"
              label="Create a new Gateway"
              isChecked={!state.useExistingGateway}
              onChange={() => patch({ useExistingGateway: false })}
            />
          </div>

          {state.useExistingGateway ? (
            <Field label="Gateway">
              <select
                className="rhcl-wiz-select"
                value={
                  state.existingGatewayName
                    ? `${state.existingGatewayNamespace}/${state.existingGatewayName}`
                    : ''
                }
                onChange={(e) => {
                  const [ns, name] = e.target.value.split('/');
                  patch({ existingGatewayNamespace: ns || '', existingGatewayName: name || '' });
                }}
              >
                <option value="">{gwLoaded ? 'Select gateway…' : 'Loading…'}</option>
                {(gateways || []).map((g) => (
                  <option
                    key={g.metadata?.uid}
                    value={`${g.metadata?.namespace}/${g.metadata?.name}`}
                  >
                    {g.metadata?.namespace}/{g.metadata?.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Gateway name">
                <input
                  className="rhcl-wiz-input"
                  value={state.gatewayName}
                  placeholder="my-api-gateway"
                  onChange={(e) => patch({ gatewayName: e.target.value })}
                />
              </Field>
              <Field label="Listener protocol">
                <select
                  className="rhcl-wiz-select"
                  value={state.listenerProtocol}
                  onChange={(e) => {
                    const proto = e.target.value as WizardState['listenerProtocol'];
                    patch({
                      listenerProtocol: proto,
                      listenerPort: proto === 'HTTPS' ? 443 : 80,
                      tlsEnabled: proto === 'HTTPS',
                    });
                  }}
                >
                  <option value="HTTPS">HTTPS</option>
                  <option value="HTTP">HTTP</option>
                </select>
              </Field>
              <Field label="Listener port">
                <input
                  className="rhcl-wiz-input"
                  type="number"
                  value={state.listenerPort}
                  onChange={(e) => patch({ listenerPort: Number(e.target.value) })}
                />
              </Field>
              <div style={{ marginTop: 10 }}>
                <Switch
                  id="tls-enabled"
                  label="Terminate TLS at the gateway"
                  isChecked={state.tlsEnabled}
                  onChange={(_e, v) => patch({ tlsEnabled: v })}
                />
              </div>
            </>
          )}

          <Field
            label={state.useExistingGateway ? 'Public hostname' : 'Public hostname *'}
            hint={
              state.useExistingGateway && gatewayHostnames.length > 0
                ? 'Must match one of the hostnames the selected Gateway already advertises — otherwise the HTTPRoute lands as NoMatchingListenerHostname.'
                : state.useExistingGateway
                ? "The DNS name consumers will call. Leave empty to inherit the gateway's wildcard."
                : 'Required — a new Gateway has no wildcard to inherit. This is the DNS name consumers will call; it is used for the listener, the HTTPRoute and the TLS certificate.'
            }
          >
            {state.useExistingGateway && gatewayHostnames.length > 0 ? (
              // On an existing Gateway, showing an open text input is a
              // trap: the operator types a hostname that doesn't match
              // any listener, Istio rejects the HTTPRoute with
              // `NoMatchingListenerHostname`, and nothing works. Enum
              // the gateway's listener hostnames instead.
              <>
                <select
                  className="rhcl-wiz-select"
                  value={state.hostname}
                  onChange={(e) => patch({ hostname: e.target.value })}
                >
                  <option value="">Select a listener hostname…</option>
                  {gatewayHostnames.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                {state.hostname && hostnameMatchesGateway === false && (
                  <div className="rhcl-wiz-validation error">
                    <BanIcon /> No listener on{' '}
                    <code>
                      {state.existingGatewayNamespace}/{state.existingGatewayName}
                    </code>{' '}
                    matches this hostname.
                  </div>
                )}
                {state.hostname && hostnameMatchesGateway === true && (
                  <div className="rhcl-wiz-validation ok">
                    <CheckCircleIcon /> Matches a listener on the selected Gateway.
                  </div>
                )}
              </>
            ) : (
              <input
                className="rhcl-wiz-input"
                value={state.hostname}
                placeholder="my-api.apps.example.com"
                onChange={(e) => patch({ hostname: e.target.value })}
              />
            )}
          </Field>
        </div>
        <ArchDiagram state={state} />
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Step 4 — Routes
// ---------------------------------------------------------------------------
const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const RoutesStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => {
  const update = (id: string, p: Partial<RouteRule>) =>
    patch({ routes: state.routes.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const remove = (id: string) => patch({ routes: state.routes.filter((r) => r.id !== id) });
  const add = () =>
    patch({
      routes: [...state.routes, { id: newRouteId(), method: 'ANY', path: '/', matchType: 'PathPrefix' }],
    });

  return (
    <>
      <StepHeader
        title="Which endpoints should be exposed?"
        what="Each row becomes an HTTPRoute rule pointing at your backend. Use path prefixes for whole sections of the API, exact matches for single endpoints."
      />
      <div className="rhcl-wiz-two-col">
        <div>
          <table className="rhcl-wiz-routes-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Method</th>
                <th>Path</th>
                <th style={{ width: 130 }}>Match</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {state.routes.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>
                      <select
                        className="rhcl-wiz-select"
                        value={r.method}
                        onChange={(e) => update(r.id, { method: e.target.value })}
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="rhcl-wiz-input"
                        value={r.path}
                        placeholder="/api/v1"
                        onChange={(e) => update(r.id, { path: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="rhcl-wiz-select"
                        value={r.matchType}
                        onChange={(e) => update(r.id, { matchType: e.target.value as RouteRule['matchType'] })}
                      >
                        <option value="PathPrefix">Prefix</option>
                        <option value="Exact">Exact</option>
                      </select>
                    </td>
                    <td>
                      <Button
                        variant="plain"
                        aria-label="Delete route"
                        onClick={() => remove(r.id)}
                        isDisabled={state.routes.length === 1}
                      >
                        <TrashIcon />
                      </Button>
                    </td>
                  </tr>
                  {/*
                    Per-route backend picker — only meaningful when the
                    pool has more than one entry. Toggling a chip:
                      - all chips off (empty backendIds) → rule uses the
                        entire pool with declared weights (default split)
                      - one or more chips on             → rule is pinned
                        to that subset (per-path routing)
                    Clicking the "All" chip clears the override.
                  */}
                  {state.backends.length > 1 && (
                    <tr>
                      <td colSpan={4} style={{ borderTop: 'none', paddingTop: 0 }}>
                        <div className="rhcl-wiz-route-backends">
                          <span className="rhcl-wiz-route-backends-label">Backends:</span>
                          <button
                            className={`rhcl-wiz-route-chip${(!r.backendIds || r.backendIds.length === 0) ? ' is-active' : ''}`}
                            onClick={() => update(r.id, { backendIds: undefined })}
                            title="Use the full pool with declared weights"
                          >
                            All (weighted split)
                          </button>
                          {state.backends.map((b) => {
                            const selected = r.backendIds?.includes(b.id) ?? false;
                            const toggle = () => {
                              const current = r.backendIds || [];
                              const next = selected
                                ? current.filter((id) => id !== b.id)
                                : [...current, b.id];
                              // Empty = revert to "All".
                              update(r.id, {
                                backendIds: next.length === 0 ? undefined : next,
                              });
                            };
                            return (
                              <button
                                key={b.id}
                                className={`rhcl-wiz-route-chip${selected ? ' is-active' : ''}`}
                                onClick={toggle}
                                title={`${b.namespace}/${b.name}:${b.port ?? ''}`}
                              >
                                {b.name || 'unnamed'}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <Button variant="link" icon={<PlusCircleIcon />} onClick={add}>
            Add Route
          </Button>
        </div>
        <div>
          <div className="rhcl-wiz-route-tree">
            <div className="rhcl-wiz-route-tree-title">Route tree</div>
            {state.routes.map((r) => (
              <div key={r.id} className="rhcl-wiz-route-tree-item">
                <Label isCompact color="purple">
                  {r.method}
                </Label>
                <code>
                  {r.path || '/'}
                  {r.matchType === 'PathPrefix' ? '/*' : ''}
                </code>
                <span className="rhcl-wiz-route-tree-arrow">→</span>
                <code className="rhcl-wiz-route-tree-backend">
                  {(() => {
                    // Show the resolved backends for this route — either
                    // the override subset if present, or the whole pool.
                    const pool = state.backends;
                    const chosen =
                      r.backendIds && r.backendIds.length > 0
                        ? pool.filter((b) => r.backendIds!.includes(b.id))
                        : pool;
                    if (chosen.length === 0) return 'backend:—';
                    return chosen
                      .map((b) => `${b.name || 'backend'}:${b.port ?? ''}`)
                      .join(' + ');
                  })()}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Step 5 — Security
// ---------------------------------------------------------------------------
const AUTH_CARDS: { id: AuthMode; title: string; desc: string }[] = [
  { id: 'api-key', title: 'API Key', desc: 'Simple shared-secret header. Best for server-to-server and partner integrations.' },
  { id: 'jwt', title: 'JWT', desc: 'Validate signed tokens from your identity provider. Best for user-facing apps.' },
  { id: 'oidc', title: 'OIDC', desc: 'Full OpenID Connect discovery. Best when the IdP publishes a discovery document.' },
  { id: 'anonymous', title: 'Anonymous', desc: 'No authentication. Only for public data or internal traffic.' },
];

export const SecurityStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => (
  <>
    <StepHeader
      title="How should consumers authenticate?"
      what="This generates an AuthPolicy enforced at the gateway — your backend never sees unauthenticated traffic."
    />
    {/* Two-col matches the Backend / Gateway / Review pattern so the
        arch diagram anchors the operator's mental model on every
        substantive step — the customer read this as inconsistent when
        Security dropped it. Everything on the left continues to look
        the same; the ArchDiagram picks up `authMode` so the "auth"
        surface lights up as the operator makes the choice. */}
    <div className="rhcl-wiz-two-col">
      <div>
        <div className="rhcl-wiz-auth-grid">
          {AUTH_CARDS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rhcl-wiz-auth-card${state.authMode === c.id ? ' is-selected' : ''}`}
              onClick={() => patch({ authMode: c.id })}
            >
              <div className="rhcl-wiz-auth-title">{c.title}</div>
              <div className="rhcl-wiz-auth-desc">{c.desc}</div>
            </button>
          ))}
        </div>

        {state.authMode === 'api-key' && (
          <div className="rhcl-wiz-auth-config">
            <Field
              label="Where does the key travel?"
              hint="Header is the norm for server-to-server calls; query string is common for CDN-fronted / browser-only clients that can't set custom headers."
            >
              {/*
                Two-radio picker instead of a dropdown so both options
                are visible at a glance — the wire-format decision is
                load-bearing and often surprises browser-first teams.
              */}
              <div className="rhcl-wiz-radio-row">
                <Radio
                  id="apikey-src-header"
                  name="apikey-source"
                  label="HTTP header"
                  isChecked={state.apiKeyCredentialSource !== 'query'}
                  onChange={() =>
                    patch({
                      apiKeyCredentialSource: 'header',
                      // Snap the default value if the previous mode's
                      // hint was still in the field.
                      apiKeyHeader:
                        state.apiKeyHeader === 'api_key' || !state.apiKeyHeader
                          ? 'api-key'
                          : state.apiKeyHeader,
                    })
                  }
                />
                <Radio
                  id="apikey-src-query"
                  name="apikey-source"
                  label="Query string"
                  isChecked={state.apiKeyCredentialSource === 'query'}
                  onChange={() =>
                    patch({
                      apiKeyCredentialSource: 'query',
                      apiKeyHeader:
                        state.apiKeyHeader === 'api-key' || !state.apiKeyHeader
                          ? 'api_key'
                          : state.apiKeyHeader,
                    })
                  }
                />
              </div>
            </Field>
            <Field
              label={state.apiKeyCredentialSource === 'query' ? 'Query parameter name' : 'Header name'}
              hint={
                state.apiKeyCredentialSource === 'query'
                  ? 'Consumers pass ?<name>=<key> on every request.'
                  : 'Consumers send their key in this HTTP header.'
              }
            >
              <input
                className="rhcl-wiz-input"
                value={state.apiKeyHeader}
                onChange={(e) => patch({ apiKeyHeader: e.target.value })}
                placeholder={state.apiKeyCredentialSource === 'query' ? 'api_key' : 'api-key'}
              />
            </Field>
          </div>
        )}
        {state.authMode === 'jwt' && (
          <div className="rhcl-wiz-auth-config">
            <Field label="Issuer URL" hint="The iss claim your IdP stamps into tokens.">
              <input
                className="rhcl-wiz-input"
                value={state.jwtIssuer}
                placeholder="https://keycloak.example.com/realms/prod"
                onChange={(e) => patch({ jwtIssuer: e.target.value })}
              />
            </Field>
            <Field label="Audience (optional)">
              <input
                className="rhcl-wiz-input"
                value={state.jwtAudience}
                onChange={(e) => patch({ jwtAudience: e.target.value })}
              />
            </Field>
            <Field label="JWKS URL (optional)" hint="Defaults to the issuer's well-known JWKS endpoint.">
              <input
                className="rhcl-wiz-input"
                value={state.jwksUrl}
                onChange={(e) => patch({ jwksUrl: e.target.value })}
              />
            </Field>
          </div>
        )}
        {state.authMode === 'oidc' && (
          <div className="rhcl-wiz-auth-config">
            <Field label="Discovery URL">
              <input
                className="rhcl-wiz-input"
                value={state.oidcDiscoveryUrl}
                placeholder="https://idp.example.com/.well-known/openid-configuration"
                onChange={(e) => patch({ oidcDiscoveryUrl: e.target.value })}
              />
            </Field>
            <Field label="Client ID">
              <input
                className="rhcl-wiz-input"
                value={state.oidcClientId}
                onChange={(e) => patch({ oidcClientId: e.target.value })}
              />
            </Field>
            <Field label="Scopes">
              <input
                className="rhcl-wiz-input"
                value={state.oidcScopes}
                onChange={(e) => patch({ oidcScopes: e.target.value })}
              />
            </Field>
          </div>
        )}
        {state.authMode === 'anonymous' && (
          <div className="rhcl-wiz-validation warn">
            Anyone on the network can call this API. Pick API Key or JWT if the data isn&apos;t public.
          </div>
        )}
      </div>
      <ArchDiagram state={state} />
    </div>
  </>
);

// ---------------------------------------------------------------------------
// Step 6 — Policies
// ---------------------------------------------------------------------------
export const PoliciesStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => (
  <>
    <StepHeader
      title="Operational policies"
      what="Rate limits protect your backend, DNS publishes the hostname, TLS issues the certificate. Each toggles a dedicated Kuadrant policy — expand a section to tune it."
    />
    <div className="rhcl-wiz-policies">
      <ExpandableSection
        toggleContent={
          <span className="rhcl-wiz-policy-toggle">
            <Switch
              id="pol-rl"
              aria-label="Rate limits"
              isChecked={state.rateLimitEnabled}
              onChange={(_e, v) => patch({ rateLimitEnabled: v })}
            />
            <span>Rate Limits</span>
            {state.rateLimitEnabled && (
              <Label isCompact color="green">
                {state.rateLimit} / {state.rateWindow}
              </Label>
            )}
          </span>
        }
      >
        <div className="rhcl-wiz-policy-body">
          <Field label="Limit (requests)">
            <input
              className="rhcl-wiz-input"
              type="number"
              value={state.rateLimit}
              onChange={(e) => patch({ rateLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="Window">
            <select
              className="rhcl-wiz-select"
              value={state.rateWindow}
              onChange={(e) => patch({ rateWindow: e.target.value })}
            >
              <option value="10s">10 seconds</option>
              <option value="1m">1 minute</option>
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
            </select>
          </Field>
          {/* Scope drives the CR's counters / when predicates. The
              catalogue lives in wizardTypes.ts:RATE_LIMIT_SCOPES so
              manifests.ts and the standalone RateLimitPolicy form can
              reuse the same options + hints. */}
          <Field
            label="Scope"
            hint={
              RATE_LIMIT_SCOPES.find((s) => s.id === state.rateLimitScope)?.hint
            }
          >
            <select
              className="rhcl-wiz-select"
              value={state.rateLimitScope}
              onChange={(e) =>
                patch({ rateLimitScope: e.target.value as RateLimitScope, rateLimitScopeValue: '' })
              }
            >
              {RATE_LIMIT_SCOPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          {(() => {
            // Only IP-range / header / per-endpoint need a companion
            // value (CIDR, header name, path prefix). Everything else
            // reads state directly from the request context.
            const opt = RATE_LIMIT_SCOPES.find((s) => s.id === state.rateLimitScope);
            if (!opt?.needsValue) return null;
            const labels: Record<Exclude<typeof opt.needsValue, undefined>, { label: string; placeholder: string }> = {
              cidr: { label: 'CIDR', placeholder: '10.0.0.0/24' },
              header: { label: 'Header name', placeholder: 'X-Tenant' },
              path: { label: 'Path prefix', placeholder: '/api/v1/transfers' },
            };
            const meta = labels[opt.needsValue];
            return (
              <Field label={meta.label}>
                <input
                  className="rhcl-wiz-input"
                  value={state.rateLimitScopeValue}
                  placeholder={meta.placeholder}
                  onChange={(e) => patch({ rateLimitScopeValue: e.target.value })}
                />
              </Field>
            );
          })()}
        </div>
      </ExpandableSection>

      <ExpandableSection
        toggleContent={
          <span className="rhcl-wiz-policy-toggle">
            <Switch
              id="pol-dns"
              aria-label="DNS"
              isChecked={state.dnsEnabled}
              onChange={(_e, v) => patch({ dnsEnabled: v })}
            />
            <span>DNS</span>
            {state.dnsEnabled && state.hostname && (
              <Label isCompact color="green">
                {state.hostname}
              </Label>
            )}
          </span>
        }
      >
        <div className="rhcl-wiz-policy-body">
          <p className="rhcl-wiz-policy-note">
            Publishes the hostname on the cluster&apos;s DNS provider (managed by the DNSPolicy credentials
            secret). No fields needed for the default provider.
          </p>
        </div>
      </ExpandableSection>

      <ExpandableSection
        toggleContent={
          <span className="rhcl-wiz-policy-toggle">
            <Switch
              id="pol-tls"
              aria-label="TLS"
              isChecked={state.tlsPolicyEnabled}
              onChange={(_e, v) => patch({ tlsPolicyEnabled: v })}
            />
            <span>TLS Certificate</span>
            {state.tlsPolicyEnabled && (
              <Label isCompact color="green">
                {state.tlsIssuerName}
              </Label>
            )}
          </span>
        }
      >
        <div className="rhcl-wiz-policy-body">
          <Field label="ClusterIssuer" hint="cert-manager issuer that signs the certificate.">
            <input
              className="rhcl-wiz-input"
              value={state.tlsIssuerName}
              onChange={(e) => patch({ tlsIssuerName: e.target.value })}
            />
          </Field>
        </div>
      </ExpandableSection>

      <ExpandableSection
        toggleContent={
          <span className="rhcl-wiz-policy-toggle">
            <Switch
              id="pol-tok"
              aria-label="Token limits"
              isChecked={state.tokenLimitEnabled}
              onChange={(_e, v) => patch({ tokenLimitEnabled: v })}
            />
            <span>Token Limits (AI)</span>
            {state.tokenLimitEnabled && (
              <Label isCompact color="teal">
                {state.tokenLimit} tokens / {state.tokenWindow}
              </Label>
            )}
          </span>
        }
      >
        <div className="rhcl-wiz-policy-body">
          <Field label="Token limit">
            <input
              className="rhcl-wiz-input"
              type="number"
              value={state.tokenLimit}
              onChange={(e) => patch({ tokenLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="Window">
            <select
              className="rhcl-wiz-select"
              value={state.tokenWindow}
              onChange={(e) => patch({ tokenWindow: e.target.value })}
            >
              <option value="1m">1 minute</option>
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
            </select>
          </Field>
        </div>
      </ExpandableSection>
    </div>
  </>
);

// ---------------------------------------------------------------------------
// Step 7 — API Product
// ---------------------------------------------------------------------------
export const ProductStep: React.FC<{ state: WizardState; patch: Patch }> = ({ state, patch }) => (
  <>
    <StepHeader
      title="How will developers discover this API?"
      what="The API Product is the entry consumers see in the Developer Portal — display name, docs, plans and approval flow."
    />
    <div className="rhcl-wiz-two-col">
      <div>
        <div style={{ marginBottom: 14 }}>
          <Switch
            id="product-enabled"
            label="Publish to the Developer Portal"
            isChecked={state.productEnabled}
            onChange={(_e, v) => patch({ productEnabled: v })}
          />
        </div>
        {state.productEnabled && (
          <>
            <Field label="Display name">
              <input
                className="rhcl-wiz-input"
                value={state.displayName}
                placeholder="Banking API"
                onChange={(e) => patch({ displayName: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="rhcl-wiz-input"
                rows={3}
                value={state.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <div className="rhcl-wiz-field-row">
              <Field label="Version">
                <input
                  className="rhcl-wiz-input"
                  value={state.version}
                  onChange={(e) => patch({ version: e.target.value })}
                />
              </Field>
              <Field label="Approval mode">
                <select
                  className="rhcl-wiz-select"
                  value={state.approvalMode}
                  onChange={(e) => patch({ approvalMode: e.target.value as WizardState['approvalMode'] })}
                >
                  <option value="MANUAL">Manual approval</option>
                  <option value="AUTOMATIC">Instant access</option>
                </select>
              </Field>
            </div>
            <Field label="Tags (comma-separated)">
              <input
                className="rhcl-wiz-input"
                value={state.tags.join(', ')}
                placeholder="banking, accounts"
                onChange={(e) =>
                  patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
                }
              />
            </Field>
            {/* OpenAPI URL + visibility removed: the 1.4.1 APIProduct CRD
                has no such fields — offering knobs that don't land in the
                manifest would mislead the operator. */}
          </>
        )}
      </div>

      {/* Live portal preview card */}
      {state.productEnabled && (
        <div className="rhcl-wiz-portal-preview">
          <div className="rhcl-wiz-portal-preview-title">Developer Portal preview</div>
          <div className="rhcl-wiz-portal-card">
            <div className="rhcl-wiz-portal-card-head">
              <div className="rhcl-wiz-portal-card-icon">API</div>
              <div>
                <div className="rhcl-wiz-portal-card-name">{state.displayName || 'Your API'}</div>
                <div className="rhcl-wiz-portal-card-ver">
                  {state.version} · REST{' '}
                  {state.approvalMode === 'MANUAL' ? '· Approval required' : '· Instant access'}
                </div>
              </div>
            </div>
            <div className="rhcl-wiz-portal-card-desc">
              {state.description || 'Description shown to developers browsing the catalog.'}
            </div>
            {state.tags.length > 0 && (
              <div className="rhcl-wiz-portal-card-tags">
                {state.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  </>
);
