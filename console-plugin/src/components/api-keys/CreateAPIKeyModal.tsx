import * as React from 'react';
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  TextInput,
  TextArea,
  Alert,
  ClipboardCopy,
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import {
  useK8sWatchResource,
  k8sCreate,
  k8sDelete,
  K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import { APIProductGVK } from '../../models';
import { generateApiKeyValue } from '../wizard/wizardTypes';

/**
 * Modal that lets an operator create an APIKey CR without leaving the
 * cluster-wide list page. The CR carries the usual `spec.apiProductRef`
 * + `spec.planTier` + `spec.requestedBy` + `spec.useCase` fields the
 * Kuadrant devportal operator expects; the actual Secret is
 * provisioned by the controller on the normal APIKeyRequest →
 * APIKeyApproval path (auto-approved on APIProducts with
 * `approvalMode: automatic`, otherwise waits for an admin).
 *
 * When the operator just wants a smoke-test key for a fresh public
 * API, the Create API wizard's "Try it right away" toggle is still
 * the faster path — it emits a labeled Secret directly, bypassing
 * the APIKey CR entirely. This modal is the "proper" alternative for
 * per-consumer flows.
 */

interface APIProductResource extends K8sResourceCommon {
  spec?: {
    displayName?: string;
    approvalMode?: string;
  };
  status?: {
    discoveredPlans?: Array<{ tier?: string }>;
    // The AuthPolicy selector the product's keys must match. The plugin reads
    // the Secret labels from here rather than guessing them.
    discoveredAuthScheme?: {
      authentication?: Record<
        string,
        { apiKey?: { selector?: { matchLabels?: Record<string, string> } } }
      >;
    };
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select an APIProduct when opened from that product's page. */
  defaultProductNamespace?: string;
  defaultProductName?: string;
}

/** kebab-case the identifier so the k8s name is valid. */
function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Authorino selects a key Secret ONLY when this label is present. The key is
// created WITHOUT it (inactive) and the Approve action on the API Keys list
// adds it — that single label toggle IS the activation gate. Verified on
// cluster: adding it makes the gateway accept the key in <2s, removing it
// rejects it (401). The controller does not manage this label; the plugin does.
export const AUTHORINO_MANAGED_BY_LABEL = 'authorino.kuadrant.io/managed-by';

/**
 * Labels an *inactive* consumer-key Secret carries: everything the product's
 * AuthPolicy selector wants EXCEPT the authorino managed-by label. Sourced from
 * the APIProduct's discovered selector (`status.discoveredAuthScheme`) so the
 * plugin never hardcodes them; falls back to the `<product>-apikey` convention
 * the Create-API wizard emits when the status has not reported a scheme yet.
 * Approval adds the managed-by label to flip the key on.
 */
function inactiveKeySecretLabels(
  product: APIProductResource,
): Record<string, string> {
  const auth = product.status?.discoveredAuthScheme?.authentication || {};
  for (const scheme of Object.values(auth)) {
    const labels = scheme?.apiKey?.selector?.matchLabels;
    if (labels && Object.keys(labels).length) {
      // Strip managed-by so the Secret does not match the selector yet.
      const { [AUTHORINO_MANAGED_BY_LABEL]: _managedBy, ...rest } = labels;
      return rest;
    }
  }
  return { app: `${product.metadata?.name}-apikey` };
}

const CreateAPIKeyModal: React.FC<Props> = ({
  isOpen,
  onClose,
  defaultProductNamespace,
  defaultProductName,
}) => {
  const [products, productsLoaded] = useK8sWatchResource<APIProductResource[]>({
    groupVersionKind: APIProductGVK,
    isList: true,
  });

  const [productKey, setProductKey] = React.useState<string>(''); // "ns/name"
  const [plan, setPlan] = React.useState<string>('');
  const [userId, setUserId] = React.useState<string>('');
  const [email, setEmail] = React.useState<string>('');
  const [useCase, setUseCase] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [productOpen, setProductOpen] = React.useState(false);
  const [planOpen, setPlanOpen] = React.useState(false);
  // Set once creation succeeds: the plaintext key is only in the Secret and is
  // not shown again, so the modal reveals it here for the operator to relay.
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);

  // Reset on open/close so a stale error from a previous submission
  // doesn't linger, and pre-seed the product picker when the caller
  // told us to.
  React.useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSubmitting(false);
    setProductOpen(false);
    setPlanOpen(false);
    setCreatedKey(null);
    if (defaultProductName && defaultProductNamespace) {
      setProductKey(`${defaultProductNamespace}/${defaultProductName}`);
    }
  }, [isOpen, defaultProductName, defaultProductNamespace]);

  const selectedProduct = React.useMemo(() => {
    if (!productKey) return null;
    const [ns, name] = productKey.split('/');
    return (products || []).find(
      (p) => p.metadata?.namespace === ns && p.metadata?.name === name,
    );
  }, [products, productKey]);

  // Auto-clear plan when the product changes so the picker doesn't
  // hold onto a plan that doesn't exist on the new product.
  React.useEffect(() => {
    setPlan('');
  }, [productKey]);

  const availablePlans = React.useMemo(() => {
    const plans = selectedProduct?.status?.discoveredPlans || [];
    const uniq = new Set<string>();
    for (const p of plans) if (p.tier) uniq.add(p.tier);
    return [...uniq];
  }, [selectedProduct]);

  // Derived APIKey name — `<product>-<userId>`. Keeps the naming that
  // the existing seed data uses (banking-api-alice) so admins recognise
  // the pattern immediately.
  const derivedName = React.useMemo(() => {
    if (!selectedProduct || !userId) return '';
    return `${selectedProduct.metadata?.name}-${slugify(userId)}`;
  }, [selectedProduct, userId]);

  const canSubmit = !!(selectedProduct && plan && userId && email);

  const submit = async () => {
    if (!canSubmit || !selectedProduct) return;
    setSubmitting(true);
    setError(null);
    const ns = selectedProduct.metadata?.namespace as string;
    const productName = selectedProduct.metadata?.name as string;
    const name = derivedName;
    // RHCL/Kuadrant 1.4+ makes `spec.secretRef` REQUIRED on APIKey, and the
    // controller does NOT provision the Secret — it reads the key from a Secret
    // the client creates first (verified against the CRD schema and every key
    // on-cluster: the Secret pre-exists, has no ownerRef, holds the `api_key`).
    // Omitting it is what produced `Required value for field "spec.secretRef"`.
    //
    // The Secret is created WITHOUT the authorino managed-by label, so the key
    // starts INACTIVE — the Approve action on the API Keys list adds the label
    // to switch it on. That is the approval gate; see inactiveKeySecretLabels.
    const secretName = `apikey-${name}`;
    const apiKeyValue = generateApiKeyValue();
    const secretModel = {
      apiGroup: '',
      apiVersion: 'v1',
      kind: 'Secret',
      plural: 'secrets',
      abbr: 'S',
      label: 'Secret',
      labelPlural: 'Secrets',
      namespaced: true,
    };
    let secretCreated = false;
    try {
      // 1) Consumer-key Secret: inactive labels (no managed-by) so Authorino
      // does not select it yet, annotated so — once approved — the success
      // filters project plan-id/user-id into the request headers (that is what
      // per-consumer analytics keys on).
      await k8sCreate<K8sResourceCommon & { type?: string; stringData: unknown }>({
        model: secretModel,
        data: {
          apiVersion: 'v1',
          kind: 'Secret',
          type: 'Opaque',
          metadata: {
            name: secretName,
            namespace: ns,
            labels: inactiveKeySecretLabels(selectedProduct),
            annotations: {
              'secret.kuadrant.io/plan-id': plan,
              'secret.kuadrant.io/user-id': userId,
            },
          },
          stringData: { api_key: apiKeyValue },
        },
      });
      secretCreated = true;

      // 2) APIKey CR referencing that Secret. The plugin's models file uses the
      // K8sModel shape — k8sCreate needs apiGroup/apiVersion/plural/kind +
      // namespaced at minimum.
      await k8sCreate<K8sResourceCommon & { spec: unknown }>({
        model: {
          apiGroup: 'devportal.kuadrant.io',
          apiVersion: 'v1alpha1',
          kind: 'APIKey',
          plural: 'apikeys',
          abbr: 'AK',
          label: 'APIKey',
          labelPlural: 'APIKeys',
          namespaced: true,
        },
        data: {
          apiVersion: 'devportal.kuadrant.io/v1alpha1',
          kind: 'APIKey',
          metadata: { name, namespace: ns },
          spec: {
            apiProductRef: { name: productName },
            planTier: plan,
            requestedBy: { userId, email },
            secretRef: { name: secretName },
            useCase: useCase || `Created via Console — ${userId}`,
          },
        },
      });
      // Keep the modal open to reveal the key once — it lives only in the
      // Secret from here on and the create form is done.
      setCreatedKey(apiKeyValue);
    } catch (e) {
      // A labeled Secret with no owning APIKey is a live credential nobody
      // tracks — roll it back when the APIKey step is what failed.
      if (secretCreated) {
        try {
          await k8sDelete({
            model: secretModel,
            resource: { metadata: { name: secretName, namespace: ns } },
          });
        } catch {
          /* best-effort cleanup; surface the original error below */
        }
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      variant={ModalVariant.medium}
      isOpen={isOpen}
      onClose={onClose}
      aria-label="Create API Key"
    >
      <ModalHeader title="Create API Key" />
      <ModalBody>
        {createdKey ? (
          <div>
            <Alert variant="success" isInline title="API key created" />
            <div style={{ marginTop: 12, fontSize: 14 }}>
              Copy this key now — it is stored only in the Secret and is not
              shown again.
            </div>
            <div style={{ marginTop: 8 }}>
              <ClipboardCopy
                isReadOnly
                hoverTip="Copy"
                clickTip="Copied"
                variant="inline-compact"
              >
                {createdKey}
              </ClipboardCopy>
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: 'var(--pf-t--global--text--color--subtle)',
              }}
            >
              The key is <strong>inactive</strong> until approved on the API
              Keys list. Backing Secret <code>apikey-{derivedName}</code>.
            </div>
          </div>
        ) : !productsLoaded ? (
          <Alert variant="info" isInline title="Loading API Products…" />
        ) : (products || []).length === 0 ? (
          <Alert variant="warning" isInline title="No API Products on the cluster">
            Create an API Product first — the wizard on the Overview page can do it
            in a couple of steps.
          </Alert>
        ) : (
          <Form>
            <FormGroup label="API Product" isRequired fieldId="ck-product">
              <Select
                aria-label="API Product"
                isOpen={productOpen}
                selected={productKey}
                onOpenChange={setProductOpen}
                onSelect={(_e, v) => {
                  setProductOpen(false);
                  setProductKey(v ? String(v) : '');
                }}
                toggle={(ref: React.Ref<MenuToggleElement>) => (
                  <MenuToggle
                    ref={ref}
                    onClick={() => setProductOpen((o) => !o)}
                    isExpanded={productOpen}
                    style={{ width: '100%' }}
                  >
                    {productKey || 'Select an API Product…'}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {(products || []).map((p) => {
                    const key = `${p.metadata?.namespace}/${p.metadata?.name}`;
                    return (
                      <SelectOption key={key} value={key}>
                        <span>
                          <strong>{p.spec?.displayName || p.metadata?.name}</strong>
                          <span
                            style={{
                              color: 'var(--pf-t--global--text--color--subtle)',
                              marginLeft: 6,
                              fontSize: 12,
                            }}
                          >
                            {key}
                          </span>
                        </span>
                      </SelectOption>
                    );
                  })}
                </SelectList>
              </Select>
            </FormGroup>

            <FormGroup label="Plan" isRequired fieldId="ck-plan">
              {availablePlans.length === 0 ? (
                <Alert
                  variant="warning"
                  isInline
                  title="No plans discovered on this product"
                >
                  The APIProduct&apos;s status hasn&apos;t reported any plans yet. Attach a
                  PlanPolicy targeting the same HTTPRoute and it will appear here.
                </Alert>
              ) : (
                <Select
                  aria-label="Plan tier"
                  isOpen={planOpen}
                  selected={plan}
                  onOpenChange={setPlanOpen}
                  onSelect={(_e, v) => {
                    setPlanOpen(false);
                    setPlan(v ? String(v) : '');
                  }}
                  toggle={(ref: React.Ref<MenuToggleElement>) => (
                    <MenuToggle
                      ref={ref}
                      onClick={() => setPlanOpen((o) => !o)}
                      isExpanded={planOpen}
                      isDisabled={!selectedProduct}
                      style={{ width: '100%' }}
                    >
                      {plan || 'Select a plan…'}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {availablePlans.map((p) => (
                      <SelectOption key={p} value={p}>
                        {p}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
              )}
            </FormGroup>

            <FormGroup label="Requester user ID" isRequired fieldId="ck-uid">
              <TextInput
                id="ck-uid"
                value={userId}
                onChange={(_e, v) => setUserId(v)}
                placeholder="alice"
              />
            </FormGroup>

            <FormGroup label="Requester email" isRequired fieldId="ck-email">
              <TextInput
                id="ck-email"
                type="email"
                value={email}
                onChange={(_e, v) => setEmail(v)}
                placeholder="alice@example.com"
              />
            </FormGroup>

            <FormGroup label="Use case" fieldId="ck-usecase">
              <TextArea
                id="ck-usecase"
                value={useCase}
                onChange={(_e, v) => setUseCase(v)}
                placeholder="What is this key for? (optional)"
                autoResize
              />
            </FormGroup>

            {derivedName && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--pf-t--global--text--color--subtle)',
                }}
              >
                APIKey CR will be named{' '}
                <code>{derivedName}</code> in <code>{selectedProduct?.metadata?.namespace}</code>,
                backed by Secret <code>apikey-{derivedName}</code>.
                <div style={{ marginTop: 4 }}>
                  The key is created <strong>inactive</strong> and starts{' '}
                  <strong>Pending</strong> — approve it on the API Keys list to
                  activate.
                </div>
              </div>
            )}

            {error && (
              <Alert variant="danger" isInline title="Failed to create APIKey">
                {error}
              </Alert>
            )}
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        {createdKey ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              onClick={submit}
              isDisabled={!canSubmit || submitting}
              isLoading={submitting}
            >
              Create
            </Button>
            <Button variant="link" onClick={onClose} isDisabled={submitting}>
              Cancel
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default CreateAPIKeyModal;
