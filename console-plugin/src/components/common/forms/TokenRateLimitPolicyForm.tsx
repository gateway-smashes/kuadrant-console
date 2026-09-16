import * as React from 'react';
import {
  Alert,
  Content,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
} from '@patternfly/react-core';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import {
  RATE_LIMIT_SCOPES,
  RateLimitScope,
} from '../../wizard/wizardTypes';

/**
 * TokenRateLimitPolicy form — shape-identical to RateLimitPolicy at the
 * CR level (kuadrant.io/v1alpha1 vs v1, but the fields the operator
 * touches are the same); the only user-facing difference is the unit.
 * Requests → tokens, and the field labels reflect that.
 *
 * We deliberately reuse the same RATE_LIMIT_SCOPES catalogue: an AI
 * endpoint might want per-consumer tokens, per-plan tokens, per-header
 * tokens (multi-tenant tenant-scoped budget), etc — the same axes.
 * Keeping one catalogue means changes propagate to both surfaces
 * without drift.
 *
 * Same "no local state, parse yaml every render" pattern as the sister
 * forms — see AuthPolicyForm.tsx for the rationale.
 */

type TargetKind = 'Gateway' | 'HTTPRoute';

interface Rate {
  limit: number;
  window: string;
}
interface RateLimit {
  rates?: Rate[];
  counters?: Array<{ expression?: string }>;
  when?: Array<{ predicate?: string }>;
}
type LimitsMap = Record<string, RateLimit>;
interface Shape {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    targetRef?: { group?: string; kind?: string; name?: string };
    limits?: LimitsMap;
  };
}

interface FormValues {
  name: string;
  namespace: string;
  targetKind: TargetKind;
  targetName: string;
  limit: number;
  window: string;
  scope: RateLimitScope;
  scopeValue: string;
  /** Free-text override for `counters[0].expression`. See the
   *  RateLimitPolicyForm sister for the "scope is a guide, this is what
   *  actually ships" rationale. */
  counterExpression: string;
  /** Free-text override for `when[0].predicate`. */
  whenPredicate: string;
}

/** Same preset table the sister form uses — see RateLimitPolicyForm
 *  for the pattern. Duplicated so this form stays self-contained. */
function presetForScope(
  scope: RateLimitScope,
  scopeValue: string,
): { counter: string; when: string } | null {
  switch (scope) {
    case 'per-consumer':
      return { counter: 'auth.identity.userid', when: '' };
    case 'global':
      return { counter: '', when: '' };
    case 'per-ip':
      return { counter: 'source.remote_address', when: '' };
    case 'per-ip-range': {
      const cidr = scopeValue || '0.0.0.0/0';
      return {
        counter: 'source.remote_address',
        when: `source.remote_address.split(":")[0].startsWith("${cidr.split('/')[0]}")`,
      };
    }
    case 'per-header': {
      const header = scopeValue || 'X-Tenant';
      return { counter: `request.headers.${header.toLowerCase()}`, when: '' };
    }
    case 'per-endpoint': {
      const path = scopeValue || '/';
      return { counter: '', when: `request.path.startsWith("${path}")` };
    }
    case 'per-plan':
      return null;
  }
}

const WINDOW_OPTIONS: Array<{ v: string; l: string }> = [
  { v: '1m', l: '1 minute' },
  { v: '5m', l: '5 minutes' },
  { v: '1h', l: '1 hour' },
  { v: '1d', l: '1 day' },
];

/**
 * Reverse-engineer the scope from an existing manifest. Same logic as
 * RateLimitPolicyForm.detectScope — kept in sync manually. If we grow
 * more scope-driven policy Kinds we should extract this into a shared
 * helper; today two duplicates read cleaner than a shared abstraction.
 */
function detectScope(limits: LimitsMap | undefined):
  { scope: RateLimitScope; scopeValue: string } {
  if (!limits) return { scope: 'per-consumer', scopeValue: '' };
  const names = Object.keys(limits);
  const anyPlan = names.some((n) =>
    (limits[n].when || []).some((w) => (w.predicate || '').includes('auth.identity.plan')),
  );
  if (anyPlan && names.length >= 2) return { scope: 'per-plan', scopeValue: '' };
  const first = limits[names[0]];
  const counterExpr = first?.counters?.[0]?.expression || '';
  const whenPred = first?.when?.[0]?.predicate || '';
  if (counterExpr === 'auth.identity.userid') return { scope: 'per-consumer', scopeValue: '' };
  if (counterExpr === 'source.remote_address' && !whenPred) return { scope: 'per-ip', scopeValue: '' };
  if (counterExpr === 'source.remote_address' && whenPred.includes('startsWith')) {
    const m = whenPred.match(/startsWith\("([^"]+)"\)/);
    return { scope: 'per-ip-range', scopeValue: m ? `${m[1]}/32` : '' };
  }
  if (counterExpr.startsWith('request.headers.')) {
    return { scope: 'per-header', scopeValue: counterExpr.slice('request.headers.'.length) };
  }
  if (whenPred.includes('request.path.startsWith')) {
    const m = whenPred.match(/startsWith\("([^"]+)"\)/);
    return { scope: 'per-endpoint', scopeValue: m ? m[1] : '' };
  }
  if (!counterExpr && !whenPred) return { scope: 'global', scopeValue: '' };
  return { scope: 'per-consumer', scopeValue: '' };
}

function extractValues(obj: Shape | null): FormValues | null {
  if (!obj || typeof obj !== 'object' || obj.kind !== 'TokenRateLimitPolicy') return null;
  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const target = spec.targetRef || {};
  const limits = spec.limits;
  const firstLimit = limits ? Object.values(limits)[0] : undefined;
  const firstRate = firstLimit?.rates?.[0];
  const { scope, scopeValue } = detectScope(limits);
  const counterExpression = scope === 'per-plan' ? '' : firstLimit?.counters?.[0]?.expression || '';
  const whenPredicate = scope === 'per-plan' ? '' : firstLimit?.when?.[0]?.predicate || '';
  return {
    name: meta.name || '',
    namespace: meta.namespace || '',
    targetKind: (target.kind as TargetKind) === 'HTTPRoute' ? 'HTTPRoute' : 'Gateway',
    targetName: target.name || '',
    limit: firstRate?.limit ?? 10_000,
    window: firstRate?.window ?? '1m',
    scope,
    scopeValue,
    counterExpression,
    whenPredicate,
  };
}

function buildLimits(v: FormValues): LimitsMap {
  const rates = [{ limit: v.limit, window: v.window }];
  if (v.scope === 'per-plan') {
    return {
      gold: { rates, when: [{ predicate: 'auth.identity.plan == "gold"' }] },
      silver: {
        rates: [{ limit: Math.max(1, Math.floor(v.limit / 2)), window: v.window }],
        when: [{ predicate: 'auth.identity.plan == "silver"' }],
      },
      bronze: {
        rates: [{ limit: Math.max(1, Math.floor(v.limit / 4)), window: v.window }],
        when: [{ predicate: 'auth.identity.plan == "bronze"' }],
      },
    };
  }
  const counter = v.counterExpression.trim();
  const when = v.whenPredicate.trim();
  const limitBody: LimitsMap[string] = { rates };
  if (counter) limitBody.counters = [{ expression: counter }];
  if (when) limitBody.when = [{ predicate: when }];
  const key =
    v.scope === 'per-endpoint' && v.scopeValue
      ? `limit-${v.scopeValue.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root'}`
      : 'default';
  return { [key]: limitBody };
}

function toManifest(v: FormValues): Shape {
  return {
    apiVersion: 'kuadrant.io/v1alpha1',
    kind: 'TokenRateLimitPolicy',
    metadata: { name: v.name, namespace: v.namespace },
    spec: {
      targetRef: {
        group: 'gateway.networking.k8s.io',
        kind: v.targetKind,
        name: v.targetName,
      },
      limits: buildLimits(v),
    },
  };
}

interface Props {
  yaml: string;
  onChange: (yaml: string) => void;
}

const TokenRateLimitPolicyForm: React.FC<Props> = ({ yaml, onChange }) => {
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
            : 'The YAML shape does not match TokenRateLimitPolicy. Edit in the YAML tab.'}
        </Alert>
      </div>
    );
  }
  const update = (patch: Partial<FormValues>) => {
    const next = { ...values, ...patch };
    onChange(yamlDump(toManifest(next), { lineWidth: 0, noRefs: true, sortKeys: false }));
  };
  const scopeOpt = RATE_LIMIT_SCOPES.find((s) => s.id === values.scope);
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
      <FormGroup label="Kind">
        <FormSelect value={values.targetKind} onChange={(_e, v) => update({ targetKind: v as TargetKind })}>
          <FormSelectOption value="Gateway" label="Gateway" />
          <FormSelectOption value="HTTPRoute" label="HTTPRoute" />
        </FormSelect>
      </FormGroup>
      <FormGroup label={`${values.targetKind} name`} isRequired>
        <TextInput value={values.targetName} onChange={(_e, v) => update({ targetName: v })} />
      </FormGroup>

      <Content>
        <h4 style={{ margin: '4px 0' }}>Token budget</h4>
      </Content>
      <FormGroup label="Tokens" isRequired>
        <TextInput
          type="number"
          value={values.limit}
          onChange={(_e, v) => update({ limit: Number(v) || 0 })}
        />
      </FormGroup>
      <FormGroup label="Window">
        <FormSelect value={values.window} onChange={(_e, v) => update({ window: v })}>
          {WINDOW_OPTIONS.map((o) => (
            <FormSelectOption key={o.v} value={o.v} label={o.l} />
          ))}
        </FormSelect>
      </FormGroup>

      <FormGroup label="Scope (preset)">
        <FormSelect
          value={values.scope}
          onChange={(_e, v) => {
            const nextScope = v as RateLimitScope;
            const preset = presetForScope(nextScope, '');
            update({
              scope: nextScope,
              scopeValue: '',
              counterExpression: preset ? preset.counter : '',
              whenPredicate: preset ? preset.when : '',
            });
          }}
        >
          {RATE_LIMIT_SCOPES.map((s) => (
            <FormSelectOption key={s.id} value={s.id} label={s.label} />
          ))}
        </FormSelect>
        {scopeOpt?.hint && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
            {scopeOpt.hint}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
          The scope populates the fields below with a starting expression. Whatever ends up in
          those fields is what gets written to the CR — edit them if the preset isn&apos;t
          quite right.
        </div>
      </FormGroup>

      {scopeOpt?.needsValue && (
        <FormGroup
          label={
            scopeOpt.needsValue === 'cidr' ? 'CIDR' :
            scopeOpt.needsValue === 'header' ? 'Header name' : 'Path prefix'
          }
        >
          <TextInput
            value={values.scopeValue}
            onChange={(_e, v) => {
              const preset = presetForScope(values.scope, v);
              update({
                scopeValue: v,
                counterExpression: preset ? preset.counter : values.counterExpression,
                whenPredicate: preset ? preset.when : values.whenPredicate,
              });
            }}
            placeholder={
              scopeOpt.needsValue === 'cidr' ? '10.0.0.0/24' :
              scopeOpt.needsValue === 'header' ? 'X-Tenant' : '/api/v1/chat/completions'
            }
          />
        </FormGroup>
      )}

      {values.scope !== 'per-plan' && (
        <>
          <Content>
            <h4 style={{ margin: '4px 0' }}>Counter and predicate (actual CR values)</h4>
          </Content>
          <FormGroup label="Counter attribute (counters[0].expression)">
            <TextInput
              value={values.counterExpression}
              onChange={(_e, v) => update({ counterExpression: v })}
              placeholder="auth.identity.userid"
              style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
              CEL expression Limitador reads to bucket token usage. Blank means a single shared
              token budget.
            </div>
          </FormGroup>
          <FormGroup label="When predicate (when[0].predicate)">
            <TextInput
              value={values.whenPredicate}
              onChange={(_e, v) => update({ whenPredicate: v })}
              placeholder='request.path.startsWith("/api/v1/chat")'
              style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
              Optional CEL gating this limit. Blank means the limit applies to every request.
            </div>
          </FormGroup>
        </>
      )}
      {values.scope === 'per-plan' && (
        <Alert variant="info" isInline title="Per-plan is a fan-out">
          Per-plan emits gold / silver / bronze named limits with plan-specific `when` predicates.
          Edit the YAML tab to tune per-tier budgets.
        </Alert>
      )}

      <Alert variant="info" isInline title="Requires a token counter">
        Token counting only works when the gateway is running the Limitador wasm token counter (the
        cost-monitoring stack from req018). Without it the CR is accepted but no tokens are
        deducted.
      </Alert>
    </div>
  );
};

export default TokenRateLimitPolicyForm;
