import * as React from 'react';
import {
  Alert,
  Content,
  FormGroup,
  Radio,
  TextInput,
} from '@patternfly/react-core';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { NamespacedNameSelect } from './RefSelects';
import { GatewayGVK, HTTPRouteGVK } from '../../../models';

/**
 * Guided form for an AuthPolicy CR. Renders the tiny subset of the
 * schema the wizard already knows about (targetRef + rules.authentication
 * for api-key / jwt / anonymous) so operators don't need to type YAML
 * for the common cases. The Form tab and the YAML tab share the same
 * text via {yaml, onChange}: every input change re-serialises the
 * struct and pushes the new YAML up. The user can jump to YAML for any
 * field the form doesn't expose.
 *
 * Design choice: the form doesn't hold its own state. It parses `yaml`
 * every render, drops shape mismatches into `parseError`, and rebuilds
 * the object from partial fields on each change. That keeps Form <-> YAML
 * in perfect sync (no "stale form after typing in YAML" surprise) at
 * the cost of re-parsing per keystroke — cheap for a ~20-line manifest.
 */

type AuthMode = 'api-key' | 'jwt' | 'anonymous';
type TargetKind = 'Gateway' | 'HTTPRoute';

interface AuthPolicyShape {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    targetRef?: { group?: string; kind?: string; name?: string };
    rules?: {
      authentication?: Record<string, Record<string, unknown>>;
    };
  };
}

interface FormValues {
  name: string;
  namespace: string;
  targetKind: TargetKind;
  targetName: string;
  authMode: AuthMode;
  apiKeyHeader: string;
  apiKeyAppLabel: string;
  jwtIssuerUrl: string;
  jwtAudience: string;
}

function extractValues(obj: AuthPolicyShape | null): FormValues | null {
  if (!obj || typeof obj !== 'object' || obj.kind !== 'AuthPolicy') return null;
  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const target = spec.targetRef || {};
  const auth = spec.rules?.authentication || {};
  // Pick the first authentication rule we can identify. In practice
  // the wizard emits exactly one; users who want multi-rule policies
  // drop to the YAML tab.
  const [firstEntry] = Object.entries(auth);
  const firstKey = firstEntry?.[0] || 'api-key-users';
  const firstValue = firstEntry?.[1] || {};
  let mode: AuthMode = 'anonymous';
  let apiKeyHeader = 'api-key';
  let apiKeyAppLabel = '';
  let jwtIssuerUrl = '';
  let jwtAudience = '';
  if ('apiKey' in firstValue) {
    mode = 'api-key';
    const apiKey = (firstValue.apiKey as Record<string, unknown>) || {};
    const selector = apiKey.selector as { matchLabels?: Record<string, string> } | undefined;
    apiKeyAppLabel = selector?.matchLabels?.app || '';
    const creds = firstValue.credentials as Record<string, unknown> | undefined;
    const authHeader = creds?.authorizationHeader as { prefix?: string } | undefined;
    const customHeader = creds?.customHeader as { name?: string } | undefined;
    apiKeyHeader = customHeader?.name || authHeader?.prefix?.toLowerCase() || 'api-key';
  } else if ('jwt' in firstValue) {
    mode = 'jwt';
    const jwt = ((firstValue.jwt as Record<string, unknown>) || {}).jwt as Record<string, unknown> || {};
    jwtIssuerUrl = (jwt.issuerUrl as string) || '';
    const auds = (firstValue.jwt as Record<string, unknown>)?.audiences as string[] | undefined;
    jwtAudience = auds?.[0] || '';
  } else if ('anonymous' in firstValue) {
    mode = 'anonymous';
  }
  // Suppress "unused" lint for firstKey — kept for future use if we
  // ever expose the rule name.
  void firstKey;
  return {
    name: meta.name || '',
    namespace: meta.namespace || '',
    targetKind: ((target.kind as TargetKind) === 'HTTPRoute') ? 'HTTPRoute' : 'Gateway',
    targetName: target.name || '',
    authMode: mode,
    apiKeyHeader,
    apiKeyAppLabel,
    jwtIssuerUrl,
    jwtAudience,
  };
}

function toManifest(v: FormValues): AuthPolicyShape {
  let authentication: Record<string, Record<string, unknown>>;
  switch (v.authMode) {
    case 'api-key':
      authentication = {
        'api-key-users': {
          apiKey: {
            selector: v.apiKeyAppLabel
              ? { matchLabels: { app: v.apiKeyAppLabel } }
              : undefined,
          },
          credentials: {
            customHeader: { name: v.apiKeyHeader || 'api-key' },
          },
        },
      };
      break;
    case 'jwt':
      authentication = {
        jwt: {
          jwt: { issuerUrl: v.jwtIssuerUrl },
          ...(v.jwtAudience ? { audiences: [v.jwtAudience] } : {}),
        },
      };
      break;
    case 'anonymous':
    default:
      authentication = { anon: { anonymous: {} } };
      break;
  }
  return {
    apiVersion: 'kuadrant.io/v1',
    kind: 'AuthPolicy',
    metadata: { name: v.name, namespace: v.namespace },
    spec: {
      targetRef: {
        group: 'gateway.networking.k8s.io',
        kind: v.targetKind,
        name: v.targetName,
      },
      rules: { authentication },
    },
  };
}

interface Props {
  yaml: string;
  onChange: (yaml: string) => void;
}

const AuthPolicyForm: React.FC<Props> = ({ yaml, onChange }) => {
  let parsed: AuthPolicyShape | null = null;
  let parseError: string | null = null;
  try {
    parsed = yamlLoad(yaml) as AuthPolicyShape;
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
            : 'The YAML shape does not match AuthPolicy. Edit in the YAML tab.'}
        </Alert>
      </div>
    );
  }
  const update = (patch: Partial<FormValues>) => {
    const next = { ...values, ...patch };
    onChange(yamlDump(toManifest(next), { lineWidth: 0, noRefs: true, sortKeys: false }));
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
      <FormGroup label="Kind" role="radiogroup">
        <div style={{ display: 'flex', gap: 16 }}>
          <Radio
            id="apf-target-gw"
            name="apf-target"
            label="Gateway"
            isChecked={values.targetKind === 'Gateway'}
            onChange={() => update({ targetKind: 'Gateway' })}
          />
          <Radio
            id="apf-target-hr"
            name="apf-target"
            label="HTTPRoute"
            isChecked={values.targetKind === 'HTTPRoute'}
            onChange={() => update({ targetKind: 'HTTPRoute' })}
          />
        </div>
      </FormGroup>
      <FormGroup label={`${values.targetKind} name`} isRequired>
        <NamespacedNameSelect
          gvk={values.targetKind === 'Gateway' ? GatewayGVK : HTTPRouteGVK}
          namespace={values.namespace}
          value={values.targetName}
          onChange={(name) => update({ targetName: name })}
          kindLabel={values.targetKind}
        />
      </FormGroup>

      <Content>
        <h4 style={{ margin: '4px 0' }}>Authentication</h4>
      </Content>
      <FormGroup label="Mode" role="radiogroup">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Radio
            id="apf-mode-key"
            name="apf-mode"
            label="API key"
            isChecked={values.authMode === 'api-key'}
            onChange={() => update({ authMode: 'api-key' })}
          />
          <Radio
            id="apf-mode-jwt"
            name="apf-mode"
            label="JWT"
            isChecked={values.authMode === 'jwt'}
            onChange={() => update({ authMode: 'jwt' })}
          />
          <Radio
            id="apf-mode-anon"
            name="apf-mode"
            label="Anonymous"
            isChecked={values.authMode === 'anonymous'}
            onChange={() => update({ authMode: 'anonymous' })}
          />
        </div>
      </FormGroup>

      {values.authMode === 'api-key' && (
        <>
          <FormGroup label="Header name">
            <TextInput
              value={values.apiKeyHeader}
              onChange={(_e, v) => update({ apiKeyHeader: v })}
              placeholder="api-key"
            />
          </FormGroup>
          <FormGroup
            label="API-Key Secret label selector (app=...)"
          >
            <TextInput
              value={values.apiKeyAppLabel}
              onChange={(_e, v) => update({ apiKeyAppLabel: v })}
              placeholder="banking-api-apikey"
            />
          </FormGroup>
        </>
      )}
      {values.authMode === 'jwt' && (
        <>
          <FormGroup label="Issuer URL" isRequired>
            <TextInput
              value={values.jwtIssuerUrl}
              onChange={(_e, v) => update({ jwtIssuerUrl: v })}
              placeholder="https://keycloak.example.com/realms/rhcl"
            />
          </FormGroup>
          <FormGroup label="Audience">
            <TextInput
              value={values.jwtAudience}
              onChange={(_e, v) => update({ jwtAudience: v })}
              placeholder="rhcl-api"
            />
          </FormGroup>
        </>
      )}
      {values.authMode === 'anonymous' && (
        <Alert variant="info" isInline title="Anonymous access">
          Every request will be accepted without credentials. Useful for public read-only
          endpoints.
        </Alert>
      )}
    </div>
  );
};

export default AuthPolicyForm;
