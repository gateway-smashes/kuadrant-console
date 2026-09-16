import * as React from 'react';
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tabs,
  Tab,
  TabTitleText,
  Button,
  Alert,
  Content,
  TextArea,
} from '@patternfly/react-core';
import {
  k8sCreate,
  k8sUpdate,
  K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AuthPolicyForm from './forms/AuthPolicyForm';
import RateLimitPolicyForm from './forms/RateLimitPolicyForm';
import TokenRateLimitPolicyForm from './forms/TokenRateLimitPolicyForm';
import DNSPolicyForm from './forms/DNSPolicyForm';
import TLSPolicyForm from './forms/TLSPolicyForm';
import GatewayForm from './forms/GatewayForm';
import HTTPRouteForm from './forms/HTTPRouteForm';
import GRPCRouteForm from './forms/GRPCRouteForm';

/**
 * Every Kind we currently render a guided form for. The tab defaults to
 * 'form' when a Kind lives in this map and 'yaml' otherwise. Adding a
 * new form is: import the component + add the entry.
 */
const FORMS_BY_KIND: Record<string, React.FC<{ yaml: string; onChange: (yaml: string) => void }>> = {
  AuthPolicy: AuthPolicyForm,
  RateLimitPolicy: RateLimitPolicyForm,
  TokenRateLimitPolicy: TokenRateLimitPolicyForm,
  DNSPolicy: DNSPolicyForm,
  TLSPolicy: TLSPolicyForm,
  Gateway: GatewayForm,
  HTTPRoute: HTTPRouteForm,
  GRPCRoute: GRPCRouteForm,
};

/**
 * Shared Create / Edit modal for every Kubernetes Kind the plugin
 * writes to. Two tabs: a **Form** view (Kind-specific rendered fields —
 * currently a placeholder awaiting per-Kind form components) and a
 * **YAML** view that is fully functional today. When we ship per-Kind
 * forms, the Form tab becomes the default and YAML remains as the
 * fallback for advanced edits — same modal, no rewiring on the call
 * sites.
 *
 * Design choices:
 *
 *   - **One modal for Create and Edit** so consumers don't have to keep
 *     two nearly-identical widgets in sync. `mode` toggles which SDK
 *     verb runs and whether the YAML seed is a starter template or the
 *     existing resource dumped back out.
 *   - **Redirect on success** goes through `history.push` — kept inside
 *     the plugin's router so we don't blink into Console's native page
 *     while the operator is mid-flow. Callers pass `redirectTo` (usually
 *     the resource's detail path). On Edit we default to the current
 *     URL so the operator stays put.
 *   - **Guard-rails on submit** parse the YAML client-side first —
 *     browsers won't render the API-server's response body for a bad
 *     dry-run, and the parse error is nearly always the real problem
 *     ("`   -` in the wrong column").
 *
 * ANNEXED CONCERN — schema validation. Console's native `~new` YAML
 * editor uses the CRD's OpenAPI schema via Monaco. We don't do that
 * here yet; the API server is our validator on submit. Acceptable for
 * a PoC surface, worth revisiting if the plugin ships to a wider
 * audience.
 */

export type EditorMode = 'create' | 'edit';

export interface ResourceEditorModalProps {
  isOpen: boolean;
  mode: EditorMode;

  /** GVK the modal is writing. `group` omitted for core kinds. */
  gvk: { group?: string; version: string; kind: string };
  /** Plural REST name (`httproutes`, `authpolicies`). Passed to the
   *  K8sModel — the SDK infers the URL path from it. */
  plural: string;
  /** Whether the Kind is namespaced. Cluster-scoped modals hide the
   *  namespace expectation and let YAML declare `metadata.namespace`
   *  freely (though most tools drop it). */
  namespaced?: boolean;

  /** For create: seed YAML. For edit: not used — the resource is
   *  dumped instead. */
  starterYaml?: string;
  /** For edit: the resource to load into the YAML tab. Ignored on
   *  create. */
  initialResource?: K8sResourceCommon;

  /** Human hint under the YAML editor (e.g. "targetRef must be a
   *  Gateway or HTTPRoute"). Optional. */
  hint?: string;

  /** Where to send the operator after a successful submit. Defaults
   *  to the current pathname (edit-in-place). */
  redirectTo?: string;

  onClose: () => void;
}

/**
 * Pull the object identity for k8sUpdate — needs ns + name separately
 * from the payload. We refuse to guess: a submit where the YAML's
 * metadata.name changed from the loaded resource's name is an
 * accident (rename via replace is not supported by the API server on
 * most Kinds; you delete and re-create instead).
 */
function readIdentity(obj: unknown): { name: string; namespace?: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  const meta = (obj as { metadata?: { name?: string; namespace?: string } }).metadata;
  if (!meta?.name) return null;
  return { name: meta.name, namespace: meta.namespace };
}

const ResourceEditorModal: React.FC<ResourceEditorModalProps> = ({
  isOpen,
  mode,
  gvk,
  plural,
  namespaced = true,
  starterYaml,
  initialResource,
  hint,
  redirectTo,
  onClose,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const history = useHistory();

  const [tab, setTab] = React.useState<'form' | 'yaml'>('yaml');
  const [yaml, setYaml] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed whenever the modal opens or the seed inputs change. Keeping
  // this in an effect (instead of useState initializer) means a modal
  // reused across successive Create clicks doesn't retain the previous
  // draft — surprising behavior when the user thought they were on a
  // fresh Create.
  React.useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSubmitting(false);
    // Open on Form for Kinds we have a guided form for; leave YAML as
    // the default for everything else so users of unformed Kinds don't
    // stare at a "form not available yet" placeholder.
    setTab(gvk.kind in FORMS_BY_KIND ? 'form' : 'yaml');
    if (mode === 'edit' && initialResource) {
      // Strip fields the API server owns/rejects on Update:
      //   status is subresource-managed, resourceVersion belongs to
      //   the round-trip, uid/generation must not travel.
      const clone = JSON.parse(JSON.stringify(initialResource));
      delete clone.status;
      if (clone.metadata) {
        delete clone.metadata.uid;
        delete clone.metadata.resourceVersion;
        delete clone.metadata.generation;
        delete clone.metadata.creationTimestamp;
        delete clone.metadata.managedFields;
      }
      setYaml(yamlDump(clone, { lineWidth: 0, noRefs: true, sortKeys: false }));
    } else {
      setYaml(starterYaml || '');
    }
  }, [isOpen, mode, initialResource, starterYaml]);

  const submit = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = yamlLoad(yaml);
    } catch (e) {
      setError(t('YAML parse error: {{msg}}', { msg: (e as Error).message }));
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setError(t('YAML must be a Kubernetes object.'));
      return;
    }
    const identity = readIdentity(parsed);
    if (!identity) {
      setError(t('metadata.name is required.'));
      return;
    }
    // Catch unedited placeholders early. Without this the API server
    // rejects them with a 422 whose message ("name must consist of
    // lower case alphanumeric characters, '-', ...") reads as gibberish
    // to anyone who didn't realise the starter YAML had `<slots>` for
    // them to fill in. Faster + clearer to flag it client-side.
    if (/<[^>]+>/.test(yaml)) {
      setError(
        t(
          'The YAML still contains placeholder tokens like `<name>` — replace them with real values before submitting.',
        ),
      );
      return;
    }
    // On Edit: block renames (API server refuses these on most Kinds
    // anyway, and the error surface there is worse than this one).
    if (mode === 'edit' && initialResource?.metadata?.name && identity.name !== initialResource.metadata.name) {
      setError(t('Renaming a resource is not supported — delete and re-create instead.'));
      return;
    }

    // The Console runtime re-exports `k8sCreate` as an alias for
    // `k8sCreateResource` (options-object signature), so this is the
    // correct call shape — the same one the API Publishing wizard uses.
    const model = {
      apiVersion: gvk.version,
      apiGroup: gvk.group,
      kind: gvk.kind,
      plural,
      abbr: gvk.kind.slice(0, 3).toUpperCase(),
      label: gvk.kind,
      labelPlural: plural,
      namespaced,
    };

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await k8sCreate({
          model,
          data: parsed as K8sResourceCommon,
        } as unknown as Parameters<typeof k8sCreate>[0]);
      } else {
        await k8sUpdate({
          model,
          data: parsed as K8sResourceCommon,
          ns: identity.namespace,
          name: identity.name,
        } as unknown as Parameters<typeof k8sUpdate>[0]);
      }
      onClose();
      if (redirectTo) {
        history.push(redirectTo);
      }
    } catch (e) {
      // Log the raw error to the browser console — the API server's
      // message field is what the operator needs, but the SDK sometimes
      // hands us just a Response-shaped object with a JSON body one
      // level down. `console.error(e)` gives the DevTools inspector
      // something to expand.
      // eslint-disable-next-line no-console
      console.error('[ResourceEditorModal] k8s write failed', e);
      const err = e as { message?: string; json?: { message?: string }; body?: string };
      setError(
        err?.json?.message ||
        err?.message ||
        err?.body ||
        String(e),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Disable Create while the starter YAML still has `<…>` placeholder tokens,
  // instead of letting the click through to a post-submit "Create failed" error.
  // The submit() guard above stays as a fallback.
  const hasPlaceholders = mode === 'create' && /<[^>]+>/.test(yaml);

  const title =
    mode === 'create'
      ? t('Create {{kind}}', { kind: gvk.kind })
      : t('Edit {{kind}}', { kind: gvk.kind });

  return (
    <Modal
      variant={ModalVariant.large}
      isOpen={isOpen}
      onClose={submitting ? undefined : onClose}
      aria-label={title}
    >
      <ModalHeader title={title} />
      <ModalBody>
        <Tabs activeKey={tab} onSelect={(_e, k) => setTab(k as 'form' | 'yaml')}>
          <Tab eventKey="form" title={<TabTitleText>{t('Form')}</TabTitleText>}>
            {/* Kind-specific guided forms live in ./forms/. Each one
                parses the current `yaml` on every render and pushes back
                a serialised manifest via `onChange` — no separate form
                state, so switching Form↔YAML never shows stale data.
                Kinds without a form yet fall back to the placeholder. */}
            {(() => {
              const FormForKind = FORMS_BY_KIND[gvk.kind];
              if (FormForKind) return <FormForKind yaml={yaml} onChange={setYaml} />;
              return (
                <div style={{ padding: 16 }}>
                  <Content>
                    <p>
                      {t(
                        'A guided form for {{kind}} is not available yet. Use the YAML tab — the starter template already has every required field.',
                        { kind: gvk.kind },
                      )}
                    </p>
                  </Content>
                  <div style={{ marginTop: 12 }}>
                    <Button variant="link" isInline onClick={() => setTab('yaml')}>
                      {t('Switch to YAML')}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </Tab>
          <Tab eventKey="yaml" title={<TabTitleText>{t('YAML')}</TabTitleText>}>
            <div style={{ padding: 16 }}>
              <TextArea
                aria-label={t('YAML editor')}
                value={yaml}
                onChange={(_e, v) => setYaml(v)}
                rows={22}
                resizeOrientation="vertical"
                style={{
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  fontSize: 13,
                }}
                spellCheck={false}
              />
              {hint && (
                <Content style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>{hint}</p>
                </Content>
              )}
            </div>
          </Tab>
        </Tabs>

        {error && (
          <Alert
            variant="danger"
            title={mode === 'create' ? t('Create failed') : t('Save failed')}
            isInline
            style={{ marginTop: 12 }}
          >
            {/* Preserve line breaks so a multi-line API-server error
                (e.g. field validation lists) stays readable. */}
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                fontFamily: 'inherit',
                fontSize: 'inherit',
              }}
            >
              {error}
            </pre>
          </Alert>
        )}
        {hasPlaceholders && !error && (
          <Alert
            variant="info"
            isInline
            isPlain
            title={t('Replace the placeholder tokens (like `<name>`) with real values to enable Create.')}
            style={{ marginTop: 12 }}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isLoading={submitting}
          isDisabled={submitting || hasPlaceholders}
        >
          {mode === 'create' ? t('Create') : t('Save')}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          {t('Cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ResourceEditorModal;
