import * as React from 'react';
import { FormSelect, FormSelectOption } from '@patternfly/react-core';
import {
  K8sGroupVersionKind,
  K8sResourceCommon,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { GatewayGVK, ServiceGVK } from '../../../models';

/**
 * Resource-reference pickers for the quick-create forms. They replace the
 * old free-text "type the Gateway/Service name" inputs, which silently
 * created dangling refs (a policy/route pointing at a resource that does not
 * exist, only surfaced later as `Accepted=False / TargetNotFound`).
 *
 * Each picker lists the live resources from the cluster and, when the current
 * value does not match any of them, keeps it as a "(not found)" option and
 * shows an inline warning — so an existing YAML value is never dropped, but
 * the operator is told the reference is dangling.
 *
 * Watch scoping matters: Gateways are cluster-wide (there are only a handful),
 * but Services are watched **per namespace** — a cluster-wide Services list is
 * huge and hangs the page (see the Create API wizard Backend-step fix).
 */

const warnStyle: React.CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  color: 'var(--pf-t--global--color--status--warning--default)',
};

// `<namespace>/<name>` — namespaces and names can't contain `/`, so this
// round-trips cleanly through a single FormSelect option value.
function refKey(namespace: string, name: string): string {
  return name ? `${namespace}/${name}` : '';
}

export const GatewayRefSelect: React.FC<{
  name: string;
  namespace: string;
  onChange: (ref: { name: string; namespace: string }) => void;
  ariaLabel?: string;
}> = ({ name, namespace, onChange, ariaLabel = 'Gateway' }) => {
  const [gateways] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: GatewayGVK,
    isList: true,
  });
  const options = React.useMemo(
    () =>
      (gateways || [])
        .map((g) => ({ ns: g.metadata?.namespace || '', name: g.metadata?.name || '' }))
        .filter((o) => o.name)
        .sort((a, b) => refKey(a.ns, a.name).localeCompare(refKey(b.ns, b.name))),
    [gateways],
  );
  const current = refKey(namespace, name);
  const known = options.some((o) => o.ns === namespace && o.name === name);
  return (
    <>
      <FormSelect
        value={current}
        aria-label={ariaLabel}
        onChange={(_e, v) => {
          const slash = v.lastIndexOf('/');
          onChange(
            slash >= 0
              ? { namespace: v.slice(0, slash), name: v.slice(slash + 1) }
              : { namespace: '', name: '' },
          );
        }}
      >
        <FormSelectOption value="" label="Select a Gateway…" />
        {options.map((o) => (
          <FormSelectOption key={refKey(o.ns, o.name)} value={refKey(o.ns, o.name)} label={refKey(o.ns, o.name)} />
        ))}
        {name && !known && <FormSelectOption value={current} label={`${current} (not found)`} />}
      </FormSelect>
      {name && !known && (
        <div style={warnStyle}>
          No Gateway <code>{current}</code> found on the cluster — the route/policy will not attach.
        </div>
      )}
    </>
  );
};

interface ServiceResource extends K8sResourceCommon {
  spec?: { ports?: { port: number; name?: string }[] };
}

export const ServiceRefSelect: React.FC<{
  /** Namespace whose Services to list (the route's namespace). */
  namespace: string;
  name: string;
  onChange: (ref: { name: string; port?: number }) => void;
  ariaLabel?: string;
}> = ({ namespace, name, onChange, ariaLabel = 'Backend Service' }) => {
  // Namespaced watch (null until a namespace is known) — never list Services
  // cluster-wide.
  const [services] = useK8sWatchResource<ServiceResource[]>(
    namespace ? { groupVersionKind: ServiceGVK, isList: true, namespace } : null,
  );
  const options = React.useMemo(
    () =>
      (services || [])
        .map((s) => ({ name: s.metadata?.name || '', ports: s.spec?.ports || [] }))
        .filter((o) => o.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [services],
  );
  const known = options.some((o) => o.name === name);
  return (
    <>
      <FormSelect
        value={name}
        aria-label={ariaLabel}
        onChange={(_e, v) => {
          const svc = options.find((o) => o.name === v);
          onChange({ name: v, port: svc?.ports?.[0]?.port });
        }}
      >
        <FormSelectOption value="" label={namespace ? 'Select a Service…' : 'Set the namespace first'} />
        {options.map((o) => (
          <FormSelectOption key={o.name} value={o.name} label={o.name} />
        ))}
        {name && !known && <FormSelectOption value={name} label={`${name} (not found)`} />}
      </FormSelect>
      {name && !known && namespace && (
        <div style={warnStyle}>
          No Service <code>{name}</code> in <code>{namespace}</code>.
        </div>
      )}
    </>
  );
};

/**
 * Same-namespace name picker for a policy targetRef (AuthPolicy etc.). The
 * targetRef carries no namespace — it always resolves in the policy's own
 * namespace — so this lists the given kind in `namespace` and returns just a
 * name. When the namespace has none of that kind, the empty list + note make
 * the same-namespace constraint visible (e.g. a rhcl-apps AuthPolicy can't
 * target a Gateway that lives in openshift-ingress).
 */
export const NamespacedNameSelect: React.FC<{
  gvk: K8sGroupVersionKind;
  namespace: string;
  value: string;
  onChange: (name: string) => void;
  kindLabel: string;
}> = ({ gvk, namespace, value, onChange, kindLabel }) => {
  const [items] = useK8sWatchResource<K8sResourceCommon[]>(
    namespace ? { groupVersionKind: gvk, isList: true, namespace } : null,
  );
  const names = React.useMemo(
    () =>
      (items || [])
        .map((r) => r.metadata?.name || '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const known = names.includes(value);
  return (
    <>
      <FormSelect value={value} aria-label={`${kindLabel} name`} onChange={(_e, v) => onChange(v)}>
        <FormSelectOption value="" label={namespace ? `Select a ${kindLabel}…` : 'Set the namespace first'} />
        {names.map((n) => (
          <FormSelectOption key={n} value={n} label={n} />
        ))}
        {value && !known && <FormSelectOption value={value} label={`${value} (not found)`} />}
      </FormSelect>
      {value && !known && namespace && (
        <div style={warnStyle}>
          No {kindLabel} <code>{value}</code> in <code>{namespace}</code>.
        </div>
      )}
      {!value && namespace && names.length === 0 && (
        <div style={warnStyle}>
          No {kindLabel}s in <code>{namespace}</code> — a policy targetRef must be in the same namespace.
        </div>
      )}
    </>
  );
};
