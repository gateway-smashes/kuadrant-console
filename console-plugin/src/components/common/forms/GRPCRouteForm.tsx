import * as React from 'react';
import {
  Alert,
  Button,
  Content,
  FormGroup,
  TextInput,
} from '@patternfly/react-core';
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { GatewayRefSelect, ServiceRefSelect } from './RefSelects';

/**
 * GRPCRoute form — same skeleton as HTTPRoute (parents + hostnames +
 * rules with backends), but matches key off gRPC service + method
 * instead of HTTP path + verb.
 *
 * Match types the form supports:
 *
 *   - Exact service + optional method  — e.g. `pix.v1.PixService.Send`
 *   - Any method on a service          — service only, method left blank
 *   - All (leave both blank)           — matches every gRPC call
 *
 * The CR also supports `matches[].headers[]`; skipped in the form,
 * available via the YAML tab. Same "no local state" pattern as the
 * sister forms.
 */

interface ParentRef {
  name: string;
  namespace: string;
  sectionName: string;
}
interface Match {
  service: string;
  method: string;
}
interface BackendRef {
  name: string;
  port: number;
  weight: number;
}
interface Rule {
  matches: Match[];
  backendRefs: BackendRef[];
}

interface ParentRefShape {
  name?: string;
  namespace?: string;
  sectionName?: string;
}
interface Shape {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    parentRefs?: ParentRefShape[];
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{
        method?: { service?: string; method?: string; type?: string };
      }>;
      backendRefs?: Array<{ name?: string; port?: number; weight?: number }>;
    }>;
  };
}

interface FormValues {
  name: string;
  namespace: string;
  parentRefs: ParentRef[];
  hostnames: string[];
  rules: Rule[];
}

function defaultParentRef(): ParentRef {
  return { name: '', namespace: 'openshift-ingress', sectionName: '' };
}
function defaultMatch(): Match {
  return { service: '', method: '' };
}
function defaultBackend(): BackendRef {
  return { name: '', port: 9000, weight: 1 };
}
function defaultRule(): Rule {
  return { matches: [defaultMatch()], backendRefs: [defaultBackend()] };
}

function extractValues(obj: Shape | null): FormValues | null {
  if (!obj || typeof obj !== 'object' || obj.kind !== 'GRPCRoute') return null;
  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const parentRefs: ParentRef[] = (spec.parentRefs || []).map((p) => ({
    name: p.name || '',
    namespace: p.namespace || '',
    sectionName: p.sectionName || '',
  }));
  const rules: Rule[] = (spec.rules || []).map((r) => {
    const rawMatches = r.matches || [];
    const matches: Match[] = rawMatches.length > 0
      ? rawMatches.map((m) => ({
          service: m.method?.service || '',
          method: m.method?.method || '',
        }))
      : [defaultMatch()];
    const rawBackends = r.backendRefs || [];
    const backendRefs: BackendRef[] = rawBackends.length > 0
      ? rawBackends.map((b) => ({
          name: b.name || '',
          port: b.port ?? 9000,
          weight: b.weight ?? 1,
        }))
      : [defaultBackend()];
    return { matches, backendRefs };
  });
  return {
    name: meta.name || '',
    namespace: meta.namespace || '',
    parentRefs: parentRefs.length > 0 ? parentRefs : [defaultParentRef()],
    hostnames: spec.hostnames && spec.hostnames.length > 0 ? spec.hostnames : [''],
    rules: rules.length > 0 ? rules : [defaultRule()],
  };
}

function toManifest(v: FormValues): Shape {
  return {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'GRPCRoute',
    metadata: { name: v.name, namespace: v.namespace },
    spec: {
      parentRefs: v.parentRefs
        .filter((p) => p.name.trim())
        .map((p) => {
          const out: ParentRefShape = { name: p.name.trim() };
          if (p.namespace.trim()) out.namespace = p.namespace.trim();
          if (p.sectionName.trim()) out.sectionName = p.sectionName.trim();
          return out;
        }),
      hostnames: v.hostnames.map((h) => h.trim()).filter((h) => h.length > 0),
      rules: v.rules.map((r) => ({
        matches: r.matches.map((m) => {
          // GRPCRoute allows an empty match to mean "match everything".
          // Serialise nothing rather than an empty method object when
          // both service and method are blank — keeps the YAML lean.
          const methodBlock: { service?: string; method?: string } = {};
          if (m.service.trim()) methodBlock.service = m.service.trim();
          if (m.method.trim()) methodBlock.method = m.method.trim();
          return Object.keys(methodBlock).length > 0 ? { method: methodBlock } : {};
        }),
        backendRefs: r.backendRefs
          .filter((b) => b.name.trim())
          .map((b) => ({ name: b.name.trim(), port: b.port, weight: b.weight })),
      })),
    },
  };
}

interface Props {
  yaml: string;
  onChange: (yaml: string) => void;
}

const GRPCRouteForm: React.FC<Props> = ({ yaml, onChange }) => {
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
            : 'The YAML shape does not match GRPCRoute. Edit in the YAML tab.'}
        </Alert>
      </div>
    );
  }
  const update = (patch: Partial<FormValues>) => {
    const next = { ...values, ...patch };
    onChange(yamlDump(toManifest(next), { lineWidth: 0, noRefs: true, sortKeys: false }));
  };
  const updateParent = (i: number, patch: Partial<ParentRef>) => {
    const next = [...values.parentRefs];
    next[i] = { ...next[i], ...patch };
    update({ parentRefs: next });
  };
  const updateHostname = (i: number, s: string) => {
    const next = [...values.hostnames];
    next[i] = s;
    update({ hostnames: next });
  };
  const updateRule = (i: number, patch: Partial<Rule>) => {
    const next = [...values.rules];
    next[i] = { ...next[i], ...patch };
    update({ rules: next });
  };
  const updateMatch = (ri: number, mi: number, patch: Partial<Match>) => {
    const next = [...values.rules];
    const matches = [...next[ri].matches];
    matches[mi] = { ...matches[mi], ...patch };
    next[ri] = { ...next[ri], matches };
    update({ rules: next });
  };
  const updateBackend = (ri: number, bi: number, patch: Partial<BackendRef>) => {
    const next = [...values.rules];
    const backendRefs = [...next[ri].backendRefs];
    backendRefs[bi] = { ...backendRefs[bi], ...patch };
    next[ri] = { ...next[ri], backendRefs };
    update({ rules: next });
  };
  return (
    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
      <FormGroup label="Name" isRequired>
        <TextInput value={values.name} onChange={(_e, v) => update({ name: v })} />
      </FormGroup>
      <FormGroup label="Namespace" isRequired>
        <TextInput value={values.namespace} onChange={(_e, v) => update({ namespace: v })} />
      </FormGroup>

      <Content><h4 style={{ margin: '4px 0' }}>Parent Gateways</h4></Content>
      <div style={{ display: 'grid', gap: 8 }}>
        {values.parentRefs.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, alignItems: 'start' }}>
            <FormGroup label={i === 0 ? 'Gateway' : ''}>
              <GatewayRefSelect name={p.name} namespace={p.namespace} onChange={(ref) => updateParent(i, ref)} />
            </FormGroup>
            <FormGroup label={i === 0 ? 'Section name (listener)' : ''}>
              <TextInput value={p.sectionName} onChange={(_e, v) => updateParent(i, { sectionName: v })} placeholder="grpc" />
            </FormGroup>
            <Button
              variant="plain"
              aria-label="Remove parent"
              onClick={() =>
                update({
                  parentRefs: values.parentRefs.length > 1
                    ? values.parentRefs.filter((_, j) => j !== i)
                    : [defaultParentRef()],
                })
              }
            >
              <MinusCircleIcon />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={() => update({ parentRefs: [...values.parentRefs, defaultParentRef()] })}>
            Add parent
          </Button>
        </div>
      </div>

      <Content><h4 style={{ margin: '4px 0' }}>Hostnames</h4></Content>
      <div style={{ display: 'grid', gap: 8 }}>
        {values.hostnames.map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TextInput value={h} onChange={(_e, v) => updateHostname(i, v)} placeholder="pix-grpc.example.com" style={{ flex: 1 }} />
            <Button
              variant="plain"
              aria-label="Remove hostname"
              onClick={() =>
                update({
                  hostnames: values.hostnames.length > 1
                    ? values.hostnames.filter((_, j) => j !== i)
                    : [''],
                })
              }
            >
              <MinusCircleIcon />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={() => update({ hostnames: [...values.hostnames, ''] })}>
            Add hostname
          </Button>
        </div>
      </div>

      <Content><h4 style={{ margin: '4px 0' }}>Rules</h4></Content>
      {values.rules.map((r, ri) => (
        <div
          key={ri}
          style={{
            border: '1px solid var(--pf-t--global--border--color--default)',
            borderRadius: 6,
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Rule {ri + 1}</strong>
            <Button
              variant="plain"
              aria-label="Remove rule"
              onClick={() =>
                update({
                  rules: values.rules.length > 1
                    ? values.rules.filter((_, j) => j !== ri)
                    : [defaultRule()],
                })
              }
            >
              <MinusCircleIcon />
            </Button>
          </div>

          <Content><em>Matches (gRPC service &amp; method)</em></Content>
          {r.matches.map((m, mi) => (
            <div key={mi} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
              <FormGroup label={mi === 0 ? 'Service (fully qualified)' : ''}>
                <TextInput value={m.service} onChange={(_e, v) => updateMatch(ri, mi, { service: v })} placeholder="pix.v1.PixService" />
              </FormGroup>
              <FormGroup label={mi === 0 ? 'Method (blank = any)' : ''}>
                <TextInput value={m.method} onChange={(_e, v) => updateMatch(ri, mi, { method: v })} placeholder="Send" />
              </FormGroup>
              <Button
                variant="plain"
                aria-label="Remove match"
                onClick={() => {
                  const nextMatches = r.matches.length > 1 ? r.matches.filter((_, j) => j !== mi) : [defaultMatch()];
                  updateRule(ri, { matches: nextMatches });
                }}
              >
                <MinusCircleIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={() => updateRule(ri, { matches: [...r.matches, defaultMatch()] })}>
              Add match
            </Button>
          </div>

          <Content><em>Backends</em></Content>
          {r.backendRefs.map((b, bi) => (
            <div key={bi} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px auto', gap: 8, alignItems: 'center' }}>
              <FormGroup label={bi === 0 ? 'Service name' : ''}>
                <ServiceRefSelect
                  namespace={values.namespace}
                  name={b.name}
                  onChange={(ref) => updateBackend(ri, bi, { name: ref.name, ...(ref.port ? { port: ref.port } : {}) })}
                />
              </FormGroup>
              <FormGroup label={bi === 0 ? 'Port' : ''}>
                <TextInput type="number" value={b.port} onChange={(_e, v) => updateBackend(ri, bi, { port: Number(v) || 0 })} />
              </FormGroup>
              <FormGroup label={bi === 0 ? 'Weight' : ''}>
                <TextInput type="number" value={b.weight} onChange={(_e, v) => updateBackend(ri, bi, { weight: Number(v) || 0 })} />
              </FormGroup>
              <Button
                variant="plain"
                aria-label="Remove backend"
                onClick={() => {
                  const nextBackends = r.backendRefs.length > 1 ? r.backendRefs.filter((_, j) => j !== bi) : [defaultBackend()];
                  updateRule(ri, { backendRefs: nextBackends });
                }}
              >
                <MinusCircleIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={() => updateRule(ri, { backendRefs: [...r.backendRefs, defaultBackend()] })}>
              Add backend
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="link" icon={<PlusCircleIcon />} isInline onClick={() => update({ rules: [...values.rules, defaultRule()] })}>
          Add rule
        </Button>
      </div>

      <Alert variant="info" isInline title="HTTP/2 gateway required">
        The parent listener must be HTTP or HTTPS with h2 upgrade enabled — plain HTTP/1.1
        listeners will refuse gRPC traffic.
      </Alert>
    </div>
  );
};

export default GRPCRouteForm;
