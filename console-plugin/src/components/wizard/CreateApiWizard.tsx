import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Spinner,
  Alert,
  ClipboardCopy,
  Switch,
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  DownloadIcon,
  EyeIcon,
  RocketIcon,
} from '@patternfly/react-icons';
import { k8sCreate } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  WizardState,
  defaultState,
  STEP_IDS,
  STEP_LABELS,
  StepId,
  readinessPct,
  generateApiKeyValue,
} from './wizardTypes';
import { generateAll, toYaml, exposedUrl, GeneratedResource } from './manifests';
import { ResourceSidebar, ArchDiagram, StepHeader } from './WizardShared';
import {
  TemplateStep,
  BackendStep,
  GatewayStep,
  RoutesStep,
  SecurityStep,
  PoliciesStep,
  ProductStep,
} from './WizardSteps';
import './create-api-wizard.css';

/**
 * API Publishing Wizard — outcome-oriented resource creation.
 *
 * Users don't wake up wanting to create an AuthPolicy; they want to
 * publish an API. The wizard walks Template → Backend → Gateway →
 * Routes → Security → Policies → Product → Review, generating all
 * Kuadrant resources from one state object. The persistent sidebar
 * shows the manifests build up live — the wizard teaches Kuadrant
 * while abstracting it.
 *
 * Individual resource creation stays available (Console's native
 * Create buttons on each list page) for advanced users.
 */

type CreationPhase = 'editing' | 'creating' | 'done' | 'error';

interface CreationResult {
  resource: GeneratedResource;
  ok: boolean;
  error?: string;
}

const CreateApiWizard: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [state, setState] = React.useState<WizardState>(defaultState);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<CreationPhase>('editing');
  const [results, setResults] = React.useState<CreationResult[]>([]);

  const patch = React.useCallback(
    (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p })),
    [],
  );

  const stepId: StepId = STEP_IDS[stepIndex];
  const resources = generateAll(state);

  // Per-step gate — Next stays disabled until the step's minimum is
  // answered. Template requires a pick; Backend requires the service.
  const canAdvance = (): boolean => {
    switch (stepId) {
      case 'template':
        return state.template !== null;
      case 'backend':
        return (
          state.backends.length > 0 &&
          state.backends.every((b) => !!(b.namespace && b.name && b.port))
        );
      case 'gateway':
        // A new Gateway has no wildcard to inherit, so it needs an explicit
        // hostname — otherwise the generated listener/HTTPRoute get host="" and
        // the generated TLSPolicy is invalid. An existing Gateway can inherit.
        return state.useExistingGateway
          ? !!state.existingGatewayName
          : !!(state.gatewayName && state.hostname);
      case 'routes':
        return state.routes.length > 0 && state.routes.every((r) => !!r.path);
      case 'security':
        if (state.authMode === 'jwt') return !!state.jwtIssuer;
        if (state.authMode === 'oidc') return !!state.oidcDiscoveryUrl;
        return true;
      case 'product':
        return !state.productEnabled || !!state.displayName;
      default:
        return true;
    }
  };

  const create = async () => {
    setPhase('creating');
    const out: CreationResult[] = [];
    // Sequential on purpose: Gateway before HTTPRoute before policies
    // keeps the API server from rejecting refs to missing parents, and
    // failures early in the chain stop dependent objects from being
    // created against nothing.
    for (const r of resources) {
      try {
        await k8sCreate({
          model: {
            apiVersion: r.apiVersion,
            // Undefined (not empty string) tells the SDK this is a
            // core-group resource — it then builds `/api/v1/…`
            // instead of the malformed `/apis//v1/…` that comes back
            // as a 404 "Not Found". Bit us on the wizard's test-key
            // Secret; every non-core kind (kuadrant.io/*, gateway.
            // networking.k8s.io/*) worked because their apiGroup is
            // always populated.
            apiGroup: r.apiGroup || undefined,
            kind: r.kind,
            plural: r.plural,
            abbr: r.kind.slice(0, 3).toUpperCase(),
            label: r.kind,
            labelPlural: r.plural,
            namespaced: true,
          },
          data: r.manifest as Parameters<typeof k8sCreate>[0]['data'],
        });
        out.push({ resource: r, ok: true });
      } catch (e) {
        out.push({ resource: r, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setResults(out);
    setPhase(out.every((o) => o.ok) ? 'done' : 'error');
  };

  const downloadYaml = () => {
    const blob = new Blob([toYaml(resources)], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api-resources.yaml';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Success screen ----------
  if (phase === 'done') {
    const url = exposedUrl(state);
    // When the operator asked the wizard to mint a test key on the
    // Review step, splice it into the curl example so paste-and-run
    // just works. Otherwise fall back to the placeholder so the shape
    // is still there for docs.
    const apiKeyForCurl =
      state.generateTestApiKey && state.testApiKeyValue
        ? state.testApiKeyValue
        : '<your-key>';
    const curl =
      state.authMode === 'api-key'
        ? state.apiKeyCredentialSource === 'query'
          ? // Query string: append ?<name>=<value> (or & if the base URL
            // already has one). Kuadrant's Authorino reads it from
            // request.query.<name> — nothing else needed on the wire.
            `curl "${url}${url.includes('?') ? '&' : '?'}${state.apiKeyHeader}=${apiKeyForCurl}"`
          : `curl ${url} -H "${state.apiKeyHeader}: ${apiKeyForCurl}"`
        : state.authMode === 'jwt' || state.authMode === 'oidc'
        ? `curl ${url} -H "Authorization: Bearer <token>"`
        : `curl ${url}`;
    return (
      <div className="rhcl-wiz-root rhcl-wiz-success">
        <div className="rhcl-wiz-success-inner">
          <div className="rhcl-wiz-success-icon">
            <RocketIcon />
          </div>
          <h1>{t('Your API is now published.')}</h1>
          <p className="rhcl-wiz-success-sub">
            {results.length} {t('resources created. Policies may take up to a minute to be enforced by the gateway.')}
          </p>

          <div className="rhcl-wiz-success-url">
            <div className="rhcl-wiz-success-label">{t('Available URL')}</div>
            <ClipboardCopy isReadOnly hoverTip={t('Copy endpoint')} clickTip={t('Copied')}>
              {url}
            </ClipboardCopy>
          </div>
          <div className="rhcl-wiz-success-url">
            <div className="rhcl-wiz-success-label">{t('Try it')}</div>
            <ClipboardCopy isReadOnly isCode hoverTip={t('Copy curl')} clickTip={t('Copied')}>
              {curl}
            </ClipboardCopy>
          </div>

          <div className="rhcl-wiz-success-links">
            {state.productEnabled && (
              <Link to={`/connectivity-link/api-products`}>
                <Button variant="primary">{t('Open API Product')}</Button>
              </Link>
            )}
            <Link to="/connectivity-link/gateways">
              <Button variant="secondary">{t('Open Gateway')}</Button>
            </Link>
            <Link to="/connectivity-link/cost">
              <Button variant="secondary">{t('Cost Monitoring')}</Button>
            </Link>
          </div>

          <div className="rhcl-wiz-success-resources">
            {results.map((r) => (
              <div key={`${r.resource.kind}/${r.resource.name}`} className="rhcl-wiz-success-resource">
                <CheckCircleIcon style={{ color: 'var(--pf-t--global--color--status--success--default)' }} />
                {r.resource.kind} <code>{r.resource.name}</code>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Wizard chrome ----------
  return (
    <div className="rhcl-wiz-root">
      {/* Header */}
      <div className="rhcl-wiz-header">
        <div>
          <h1>{t('Create API')}</h1>
          <p>{t('Publish a production-ready API — the wizard generates every Kuadrant resource for you.')}</p>
        </div>
        <Link to="/connectivity-link/api-products">
          <Button variant="link">{t('Cancel')}</Button>
        </Link>
      </div>

      {/* Stepper */}
      <div className="rhcl-wiz-stepper" role="tablist">
        {STEP_IDS.map((id, i) => {
          const status = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
          return (
            <React.Fragment key={id}>
              {i > 0 && <div className={`rhcl-wiz-stepper-line ${i <= stepIndex ? 'is-active' : ''}`} />}
              <button
                type="button"
                role="tab"
                aria-selected={status === 'current'}
                className={`rhcl-wiz-stepper-item is-${status}`}
                onClick={() => i < stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
              >
                <span className="rhcl-wiz-stepper-dot">
                  {status === 'done' ? <CheckCircleIcon /> : i + 1}
                </span>
                <span className="rhcl-wiz-stepper-label">{t(STEP_LABELS[id])}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Body: step content + persistent sidebar */}
      <div className="rhcl-wiz-body">
        <div className="rhcl-wiz-content">
          {phase === 'error' && (
            <Alert
              variant="danger"
              isInline
              title={t('Some resources failed to create')}
              style={{ marginBottom: 16 }}
            >
              <ul>
                {results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.resource.name}>
                      {r.resource.kind}/{r.resource.name}: {r.error}
                    </li>
                  ))}
              </ul>
            </Alert>
          )}

          {stepId === 'template' && <TemplateStep state={state} patch={patch} />}
          {stepId === 'backend' && <BackendStep state={state} patch={patch} />}
          {stepId === 'gateway' && <GatewayStep state={state} patch={patch} />}
          {stepId === 'routes' && <RoutesStep state={state} patch={patch} />}
          {stepId === 'security' && <SecurityStep state={state} patch={patch} />}
          {stepId === 'policies' && <PoliciesStep state={state} patch={patch} />}
          {stepId === 'product' && <ProductStep state={state} patch={patch} />}
          {stepId === 'review' && (
            <ReviewStep state={state} patch={patch} resources={resources} onDownload={downloadYaml} />
          )}

          {/* Footer nav */}
          <div className="rhcl-wiz-footer">
            <Button
              variant="secondary"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              isDisabled={stepIndex === 0 || phase === 'creating'}
            >
              {t('Back')}
            </Button>
            {stepId !== 'review' ? (
              <Button
                variant="primary"
                onClick={() => setStepIndex((i) => Math.min(STEP_IDS.length - 1, i + 1))}
                isDisabled={!canAdvance()}
              >
                {t('Next')}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={create}
                isDisabled={phase === 'creating' || resources.length === 0}
                icon={phase === 'creating' ? <Spinner size="sm" /> : <RocketIcon />}
              >
                {phase === 'creating' ? t('Creating…') : t('Create Resources')}
              </Button>
            )}
          </div>
        </div>

        <ResourceSidebar state={state} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Review step (inline — needs the resources + download handler)
// ---------------------------------------------------------------------------
const ReviewStep: React.FC<{
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  resources: GeneratedResource[];
  onDownload: () => void;
}> = ({ state, patch, resources, onDownload }) => {
  const pct = readinessPct(state);
  // Lazily seed the test-key value the first time the operator turns
  // the switch on. Kept as an effect (not inline in the change handler)
  // so an already-populated value (e.g. after coming back from the
  // Success screen and re-editing) isn't rotated on re-render.
  React.useEffect(() => {
    if (
      state.authMode === 'api-key' &&
      state.generateTestApiKey &&
      !state.testApiKeyValue
    ) {
      patch({ testApiKeyValue: generateApiKeyValue() });
    }
  }, [state.authMode, state.generateTestApiKey, state.testApiKeyValue, patch]);
  // View YAML in-place: operators kept asking to double-check the manifest
  // before hitting Create, and having "Download" as the only option meant
  // switching apps to read a couple of lines. The modal renders the same
  // `toYaml(resources)` output the download uses, with a ClipboardCopy for
  // paste-into-terminal workflows and readable monospace formatting.
  const [showYaml, setShowYaml] = React.useState(false);
  const yaml = React.useMemo(() => toYaml(resources), [resources]);
  return (
    <>
      <StepHeader
        title="Review and create"
        what="Everything below is generated from your answers. Preview the YAML, download it for GitOps, or create the resources directly."
      />
      <div className="rhcl-wiz-two-col">
        <div>
          <div className="rhcl-wiz-review-block">
            <div className="rhcl-wiz-review-title">Estimated URL</div>
            <code className="rhcl-wiz-review-url">{exposedUrl(state)}</code>
          </div>
          <div className="rhcl-wiz-review-block">
            <div className="rhcl-wiz-review-title">Resources ({resources.length})</div>
            <ul className="rhcl-wiz-review-list">
              {resources.map((r) => (
                <li key={`${r.kind}/${r.name}`}>
                  <CheckCircleIcon
                    style={{ color: 'var(--pf-t--global--color--status--success--default)', fontSize: 13 }}
                  />
                  <strong>{r.kind}</strong> <code>{r.namespace}/{r.name}</code>
                </li>
              ))}
            </ul>
          </div>
          {state.authMode === 'api-key' && (
            <div className="rhcl-wiz-review-block">
              <div className="rhcl-wiz-review-title">Try it right away</div>
              <div style={{ fontSize: 12, color: 'var(--pf-v5-global--Color--200)', marginBottom: 8 }}>
                Generate a random API key alongside the policies and pre-fill the curl example on
                the success screen so you can validate the endpoint without a trip to the developer
                portal. Off in production — leave it on for lab / smoke tests.
              </div>
              <Switch
                id="wiz-generate-test-key"
                label="Generate a test API key (creates a labeled Secret)"
                isChecked={state.generateTestApiKey}
                onChange={(_e, v) => patch({ generateTestApiKey: v })}
              />
              {state.generateTestApiKey && state.testApiKeyValue && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--pf-v5-global--Color--200)', marginBottom: 4 }}>
                    Preview
                  </div>
                  <ClipboardCopy isReadOnly hoverTip="Copy key" clickTip="Copied">
                    {state.testApiKeyValue}
                  </ClipboardCopy>
                </div>
              )}
            </div>
          )}
          {pct < 100 && (
            <Alert variant="warning" isInline title={`API readiness at ${pct}%`}>
              Some optional capabilities are off — check the sidebar for what's missing. You can
              still create now and add policies later.
            </Alert>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Button variant="secondary" icon={<EyeIcon />} onClick={() => setShowYaml(true)}>
              View YAML
            </Button>
            <Button variant="secondary" icon={<DownloadIcon />} onClick={onDownload}>
              Download YAML
            </Button>
          </div>
        </div>
        <ArchDiagram state={state} />
      </div>

      <Modal
        variant={ModalVariant.large}
        isOpen={showYaml}
        onClose={() => setShowYaml(false)}
        aria-label="Generated YAML"
      >
        <ModalHeader title={`Generated YAML (${resources.length} resources)`} />
        <ModalBody>
          {/*
            ClipboardCopy in "expansion" variant renders a scrolling
            read-only editor + a copy button. Preferred over a plain
            <pre> because the operator's typical next move is "copy this
            into a terminal / gist / PR" and having the button colocated
            saves a select-all + cmd-c dance.
          */}
          <ClipboardCopy
            isReadOnly
            hoverTip="Copy YAML"
            clickTip="Copied"
            variant="expansion"
            isExpanded
            isCode
            style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}
          >
            {yaml}
          </ClipboardCopy>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" icon={<DownloadIcon />} onClick={onDownload}>
            Download YAML
          </Button>
          <Button variant="link" onClick={() => setShowYaml(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default CreateApiWizard;
