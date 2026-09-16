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
 * Guided form for a RateLimitPolicy. Shares the scope catalogue with
 * the wizard so a policy created via the wizard reads back cleanly when
 * later edited via this form. See `wizardTypes.ts:RATE_LIMIT_SCOPES` for
 * the full option list and hints — and `manifests.ts:buildRateLimitLimits`
 * for how each scope translates to counters / when predicates on the CR.
 *
 * Same "parse yaml → render fields → serialise back" pattern as
 * AuthPolicyForm: the form doesn't own state, it derives everything
 * from the yaml prop and pushes changes up. See its file header for the
 * rationale.
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
interface RateLimitShape {
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
  /**
   * The CEL expression Limitador reads to bucket requests. Populated
   * from the scope preset when the user picks a scope, but exposed as
   * a free-text field so the operator sees exactly what will land in
   * `counters[0].expression` on the CR — and can tweak it. Empty
   * string means "no counter" (i.e. the shared/global bucket).
   */
  counterExpression: string;
  /**
   * The CEL predicate that gates this limit. Same pattern — auto-filled
   * from the scope preset, editable, empty means "always applies".
   */
  whenPredicate: string;
}

/**
 * The preset CEL expressions each scope pattern implies. Used to
 * pre-fill the counter / when fields when the operator picks a scope
 * from the dropdown. The scope is the "guide"; the resulting expression
 * is what actually goes on the CR — the fields below are the source of
 * truth.
 *
 * `per-plan` returns null: it's a fan-out into multiple named limits
 * with tier-specific predicates, not a single-limit shape. The form
 * disables the free fields in that case.
 */
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
      return {
        counter: `request.headers.${header.toLowerCase()}`,
        when: '',
      };
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
  { v: '10s', l: '10 seconds' },
  { v: '1m', l: '1 minute' },
  { v: '1h', l: '1 hour' },
  { v: '1d', l: '1 day' },
];

/**
 * Reverse-engineer scope + scopeValue from an existing manifest. We look
 * at counters + when predicates in the first named limit. Unknown shapes
 * default to per-consumer — the operator can override in the dropdown.
 */
function detectScope(limits: LimitsMap | undefined):
  { scope: RateLimitScope; scopeValue: string } {
  if (!limits) return { scope: 'per-consumer', scopeValue: '' };
  const names = Object.keys(limits);
  // Per-plan is unambiguous: three named limits with plan-tier `when`
  // predicates. Detect by presence of `plan ==` in any when.
  const first = limits[names[0]];
  const anyWhen = names.some((n) => (limits[n].when || []).some((w) => (w.predicate || '').includes('auth.identity.plan')));
  if (anyWhen && names.length >= 2) return { scope: 'per-plan', scopeValue: '' };

  const counters = first?.counters || [];
  const whens = first?.when || [];
  const counterExpr = counters[0]?.expression || '';
  const whenPred = whens[0]?.predicate || '';

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
  if (counters.length === 0 && whens.length === 0) return { scope: 'global', scopeValue: '' };
  return { scope: 'per-consumer', scopeValue: '' };
}

function extractValues(obj: RateLimitShape | null): FormValues | null {
  if (!obj || typeof obj !== 'object' || obj.kind !== 'RateLimitPolicy') return null;
  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const target = spec.targetRef || {};
  const limits = spec.limits;
  const firstLimit = limits ? Object.values(limits)[0] : undefined;
  const firstRate = firstLimit?.rates?.[0];
  const { scope, scopeValue } = detectScope(limits);
  // Read the ACTUAL counter/predicate off the CR so the fields below
  // reflect what will be written back, not a synthesised preset. For
  // per-plan (fan-out), we leave them blank — the shape doesn't map
  // to a single expression pair.
  const counterExpression = scope === 'per-plan' ? '' : firstLimit?.counters?.[0]?.expression || '';
  const whenPredicate = scope === 'per-plan' ? '' : firstLimit?.when?.[0]?.predicate || '';
  return {
    name: meta.name || '',
    namespace: meta.namespace || '',
    targetKind: (target.kind as TargetKind) === 'HTTPRoute' ? 'HTTPRoute' : 'Gateway',
    targetName: target.name || '',
    limit: firstRate?.limit ?? 100,
    window: firstRate?.window ?? '1m',
    scope,
    scopeValue,
    counterExpression,
    whenPredicate,
  };
}

/**
 * Turn the form values into the `spec.limits` map. Only per-plan
 * generates a fan-out (three tier-specific limits); every other scope
 * emits a single named limit whose `counters` and `when` come straight
 * from the free-text fields on the form. The scope dropdown here is
 * only a preset picker — the moment the user edits the counter or
 * predicate, those edits are what ships.
 */
function buildLimits(v: FormValues): Record<string, unknown> {
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
  const limitBody: Record<string, unknown> = { rates };
  if (counter) limitBody.counters = [{ expression: counter }];
  if (when) limitBody.when = [{ predicate: when }];
  // Per-endpoint gets a named limit for readability (matches the wizard
  // convention). Everything else stays `default` — cleaner CR.
  const key =
    v.scope === 'per-endpoint' && v.scopeValue
      ? `limit-${v.scopeValue.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root'}`
      : 'default';
  return { [key]: limitBody };
}

function toManifest(v: FormValues): RateLimitShape {
  return {
    apiVersion: 'kuadrant.io/v1',
    kind: 'RateLimitPolicy',
    metadata: { name: v.name, namespace: v.namespace },
    spec: {
      targetRef: {
        group: 'gateway.networking.k8s.io',
        kind: v.targetKind,
        name: v.targetName,
      },
      limits: buildLimits(v) as LimitsMap,
    },
  };
}

interface Props {
  yaml: string;
  onChange: (yaml: string) => void;
}

const RateLimitPolicyForm: React.FC<Props> = ({ yaml, onChange }) => {
  let parsed: RateLimitShape | null = null;
  let parseError: string | null = null;
  try {
    parsed = yamlLoad(yaml) as RateLimitShape;
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
            : 'The YAML shape does not match RateLimitPolicy. Edit in the YAML tab.'}
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
        <FormSelect
          value={values.targetKind}
          onChange={(_e, v) => update({ targetKind: v as TargetKind })}
        >
          <FormSelectOption value="Gateway" label="Gateway" />
          <FormSelectOption value="HTTPRoute" label="HTTPRoute" />
        </FormSelect>
      </FormGroup>
      <FormGroup label={`${values.targetKind} name`} isRequired>
        <TextInput value={values.targetName} onChange={(_e, v) => update({ targetName: v })} />
      </FormGroup>

      <Content>
        <h4 style={{ margin: '4px 0' }}>Rate</h4>
      </Content>
      <FormGroup label="Limit (requests)">
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
            // Picking a scope pre-fills counter + when with the preset
            // for that pattern. The operator still owns those fields
            // and can edit them afterwards. Per-plan wipes them — the
            // fan-out doesn't map to a single expression pair.
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
              // Re-derive the preset with the new scope value so
              // e.g. typing a CIDR immediately shows the updated
              // `startsWith("<cidr>")` in the predicate field.
              const preset = presetForScope(values.scope, v);
              update({
                scopeValue: v,
                counterExpression: preset ? preset.counter : values.counterExpression,
                whenPredicate: preset ? preset.when : values.whenPredicate,
              });
            }}
            placeholder={
              scopeOpt.needsValue === 'cidr' ? '10.0.0.0/24' :
              scopeOpt.needsValue === 'header' ? 'X-Tenant' : '/api/v1/transfers'
            }
          />
        </FormGroup>
      )}

      {/*
        Counter + When are shown ALWAYS (except per-plan, which is a
        fan-out). This is the "guided but not restrictive" pattern the
        customer asked for: the scope dropdown is a guide, but the
        operator sees the exact CEL that will be counted / gated and
        can freely edit either one. Empty counter = no bucket key
        (shared bucket); empty predicate = always applies.
      */}
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
              CEL expression Limitador reads to bucket requests. Blank means a single shared bucket
              (global scope).
            </div>
          </FormGroup>
          <FormGroup label="When predicate (when[0].predicate)">
            <TextInput
              value={values.whenPredicate}
              onChange={(_e, v) => update({ whenPredicate: v })}
              placeholder='request.path.startsWith("/api/v1")'
              style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
              Optional CEL gating this limit. Blank means the limit applies to every matching
              request.
            </div>
          </FormGroup>
        </>
      )}
      {values.scope === 'per-plan' && (
        <Alert variant="info" isInline title="Per-plan is a fan-out">
          Per-plan emits three named limits (gold / silver / bronze), each with its own
          plan-specific `when` predicate. Edit the YAML tab to tune per-tier expressions or
          rename plans.
        </Alert>
      )}
    </div>
  );
};

export default RateLimitPolicyForm;
