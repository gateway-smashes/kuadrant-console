import * as React from 'react';
import {
  Alert,
  Button,
  Content,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
} from '@patternfly/react-core';
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

/**
 * DNSPolicy form — publishes a Gateway's hostname on an external DNS
 * provider (Route 53, Google Cloud DNS, Azure DNS). Kuadrant reads the
 * provider credentials from a Secret referenced by `providerRefs[].name`.
 *
 * Fields the form exposes:
 *
 *   - name / namespace
 *   - target Gateway name
 *   - providerRefs[]  — list of Secret names in the same namespace
 *   - loadBalancing.weighted.defaultWeight (0-255) — optional
 *
 * targetRef.kind is fixed to Gateway (Kuadrant DNS doesn't target
 * HTTPRoute today). Same "no local state, re-parse per render" pattern
 * as the sister forms.
 */

interface ProviderRef {
  name: string;
}

interface Shape {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    targetRef?: { group?: string; kind?: string; name?: string };
    providerRefs?: ProviderRef[];
    loadBalancing?: {
      weighted?: { defaultWeight?: number };
    };
  };
}

interface FormValues {
  name: string;
  namespace: string;
  targetName: string;
  providers: string[];
  weightEnabled: boolean;
  defaultWeight: number;
}

function extractValues(obj: Shape | null): FormValues | null {
  if (!obj || typeof obj !== 'object' || obj.kind !== 'DNSPolicy') return null;
  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const providers = (spec.providerRefs || []).map((r) => r.name).filter((n): n is string => !!n);
  const weight = spec.loadBalancing?.weighted?.defaultWeight;
  return {
    name: meta.name || '',
    namespace: meta.namespace || '',
    targetName: spec.targetRef?.name || '',
    providers: providers.length > 0 ? providers : [''],
    weightEnabled: typeof weight === 'number',
    defaultWeight: weight ?? 120,
  };
}

function toManifest(v: FormValues): Shape {
  const spec: Shape['spec'] = {
    targetRef: {
      group: 'gateway.networking.k8s.io',
      kind: 'Gateway',
      name: v.targetName,
    },
    providerRefs: v.providers
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map((name) => ({ name })),
  };
  if (v.weightEnabled) {
    spec.loadBalancing = { weighted: { defaultWeight: v.defaultWeight } };
  }
  return {
    apiVersion: 'kuadrant.io/v1',
    kind: 'DNSPolicy',
    metadata: { name: v.name, namespace: v.namespace },
    spec,
  };
}

interface Props {
  yaml: string;
  onChange: (yaml: string) => void;
}

const DNSPolicyForm: React.FC<Props> = ({ yaml, onChange }) => {
  let parsed: Shape | null = null;
  let parseError: string | null = null;
  try {
    parsed = yamlLoad(yaml) as Shape;
  } catch (e) {
    parseError = (e as Error).message;
  }
  const values = extractValues(parsed);
  if (!values) {
    return (
      <div style={{ padding: 8 }}>
        <Alert variant="warning" isInline title="Cannot render form">
          {parseError
            ? `YAML failed to parse: ${parseError}.`
            : 'The YAML shape does not match DNSPolicy. Edit in the YAML tab.'}
        </Alert>
      </div>
    );
  }
  const update = (patch: Partial<FormValues>) => {
    const next = { ...values, ...patch };
    onChange(yamlDump(toManifest(next), { lineWidth: 0, noRefs: true, sortKeys: false }));
  };
  const setProvider = (i: number, name: string) => {
    const next = [...values.providers];
    next[i] = name;
    update({ providers: next });
  };
  const addProvider = () => update({ providers: [...values.providers, ''] });
  const removeProvider = (i: number) => {
    // Keep at least one row so the operator has a visible input to type
    // into; empty rows are stripped when we serialise.
    if (values.providers.length <= 1) {
      update({ providers: [''] });
      return;
    }
    update({ providers: values.providers.filter((_, j) => j !== i) });
  };
  return (
    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
      <FormGroup label="Name" isRequired>
        <TextInput value={values.name} onChange={(_e, v) => update({ name: v })} />
      </FormGroup>
      <FormGroup label="Namespace" isRequired>
        <TextInput value={values.namespace} onChange={(_e, v) => update({ namespace: v })} />
      </FormGroup>

      <Content>
        <h4 style={{ margin: '4px 0' }}>Target</h4>
      </Content>
      <FormGroup label="Gateway name" isRequired>
        <TextInput
          value={values.targetName}
          onChange={(_e, v) => update({ targetName: v })}
          placeholder="rhcl-apps-gateway"
        />
      </FormGroup>

      <Content>
        <h4 style={{ margin: '4px 0' }}>DNS providers</h4>
      </Content>
      <div style={{ display: 'grid', gap: 8 }}>
        {values.providers.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={p}
              onChange={(_e, v) => setProvider(i, v)}
              placeholder="Secret name (e.g. aws-credentials)"
              style={{ flex: 1 }}
            />
            <Button
              variant="plain"
              aria-label="Remove provider"
              onClick={() => removeProvider(i)}
              isDisabled={values.providers.length === 1 && !p}
            >
              <MinusCircleIcon />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={addProvider}>
            Add provider
          </Button>
        </div>
      </div>

      <Content>
        <h4 style={{ margin: '4px 0' }}>Load balancing</h4>
      </Content>
      <FormGroup label="Mode">
        <FormSelect
          value={values.weightEnabled ? 'weighted' : 'off'}
          onChange={(_e, v) => update({ weightEnabled: v === 'weighted' })}
        >
          <FormSelectOption value="off" label="Off (single-region)" />
          <FormSelectOption value="weighted" label="Weighted (multi-region ready)" />
        </FormSelect>
      </FormGroup>
      {values.weightEnabled && (
        <FormGroup
          label="Default weight (0–255)"
        >
          <TextInput
            type="number"
            value={values.defaultWeight}
            onChange={(_e, v) => update({ defaultWeight: Math.max(0, Math.min(255, Number(v) || 0)) })}
          />
        </FormGroup>
      )}

      <Alert variant="info" isInline title="Credentials Secret required">
        The Secret referenced by each provider must exist in the same namespace and carry the
        cloud provider&apos;s DNS credentials (Route 53, Google Cloud DNS, Azure DNS). This form does
        not create the Secret for you.
      </Alert>
    </div>
  );
};

export default DNSPolicyForm;
