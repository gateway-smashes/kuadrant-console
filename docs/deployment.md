# Deployment

How to build, deploy, verify and remove Kuadrant Console on an OpenShift
cluster. The plugin registers with the Console under the technical name
`kuadrant-console`.

> **The one thing that trips everyone up:** the plugin pod serves its bundle
> over **HTTPS on port 9001** using a service-CA-signed certificate that
> OpenShift mints automatically. The Console *requires* HTTPS for plugin
> backends — deploying without the TLS mount surfaces as **"Failed to get a
> valid plugin manifest"**. The manifests below include that mount; use them.

## Prerequisites

| Requirement | Minimum |
|---|---|
| OpenShift | 4.19+ |
| Kuadrant operator (RHCL) | Installed, with at least one Gateway |
| User-workload monitoring | Optional — metric panels degrade gracefully without it |
| `oc` CLI | 4.19+ |
| Podman or Docker | To build the container image |

## 1. Build the container image

The plugin ships as an nginx container serving the static webpack output. The
two-stage Dockerfile uses `ubi9/nodejs-22` to build and `ubi9/nginx` at runtime.

A pre-built image is published at
`quay.io/gateway-smashes/kuadrant-console:1.5.1` (also tagged `latest`,
`linux/amd64`). Use it directly and skip to step 2 unless you need a custom
build.

```bash
cd console-plugin
podman build --platform linux/amd64 -t quay.io/<org>/kuadrant-console:latest .
podman push  quay.io/<org>/kuadrant-console:latest
```

> `--platform linux/amd64` is not optional on an Apple Silicon Mac. Podman
> defaults to the host architecture, and an arm64 image fails to start on
> x86-64 cluster nodes with an exec-format error.

## 2. Deploy the plugin server

```bash
export RHCL_CONSOLE_NS=kuadrant-console
export RHCL_CONSOLE_IMAGE=quay.io/gateway-smashes/kuadrant-console:1.5.1

oc new-project "$RHCL_CONSOLE_NS" || true

cat <<EOF | oc apply -f -
apiVersion: v1
kind: Service
metadata:
  name: kuadrant-console
  namespace: $RHCL_CONSOLE_NS
  labels:
    app: kuadrant-console
  annotations:
    # Triggers the OpenShift service-CA operator to mint a TLS cert+key
    # Secret named below and rotate it before expiry. The pod mounts the
    # same Secret at /var/serving-cert.
    service.beta.openshift.io/serving-cert-secret-name: kuadrant-console-tls
spec:
  selector:
    app: kuadrant-console
  ports:
    - port: 9001
      targetPort: 9001
      protocol: TCP
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kuadrant-console
  namespace: $RHCL_CONSOLE_NS
  labels:
    app: kuadrant-console
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kuadrant-console
  template:
    metadata:
      labels:
        app: kuadrant-console
    spec:
      containers:
        - name: kuadrant-console
          image: $RHCL_CONSOLE_IMAGE
          imagePullPolicy: Always
          ports:
            - name: https
              containerPort: 9001
              protocol: TCP
          volumeMounts:
            - name: serving-cert
              mountPath: /var/serving-cert
              readOnly: true
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 200m, memory: 256Mi }
      volumes:
        - name: serving-cert
          secret:
            # Matches the Service annotation above. The Secret is populated
            # asynchronously by the service-CA operator; the pod may CrashLoop
            # briefly on the very first start while the cert lands.
            secretName: kuadrant-console-tls
EOF
```

## 3. Register the ConsolePlugin

```bash
cat <<EOF | oc apply -f -
apiVersion: console.openshift.io/v1
kind: ConsolePlugin
metadata:
  name: kuadrant-console
spec:
  displayName: Connectivity Link
  backend:
    type: Service
    service:
      name: kuadrant-console
      namespace: $RHCL_CONSOLE_NS
      port: 9001
      basePath: /
EOF
```

## 4. Enable the plugin on the cluster

```bash
oc patch console.operator.openshift.io cluster \
  --type=json \
  --patch='[{"op":"add","path":"/spec/plugins/-","value":"kuadrant-console"}]'
```

After a few seconds the Console reloads and the **Connectivity Link** section
appears in the admin navigation sidebar.

For runtime configuration (Grafana / Tempo deep links, Developer Portal links,
API-key Secrets), see **[configuration.md](configuration.md)**.

## Verification

1. Confirm the pod is **Running** and the cert Secret materialized:

   ```bash
   oc -n kuadrant-console get pods
   oc -n kuadrant-console get secret kuadrant-console-tls
   ```

2. Open the Console → **Connectivity Link → Overview**. The Environment Health
   cards should render (or an RBAC empty state if the user lacks `list` on
   `gateway.networking.k8s.io/gateways`).
3. Open a Gateway / HTTPRoute / API Product detail page and confirm the
   **Open in Grafana** / **View trace** buttons resolve — enabled when the
   in-cluster Grafana / Tempo exist (or the runtime ConfigMap points at them),
   disabled with a tooltip otherwise.
4. Open **API Products** — the business-friendly interface should show with no
   YAML or raw Kubernetes terminology.

## Common first-time issues

| Symptom | Cause | Fix |
|---|---|---|
| "Failed to get a valid plugin manifest" | Pod serving HTTP instead of HTTPS on 9001 | Use the Deployment above — it includes the `serving-cert` TLS mount |
| `CrashLoopBackOff` with `tls: no such file or directory` | service-CA hasn't materialized the Secret yet | Wait ~30s; if it persists, check the Service annotation matches the volume `secretName` |
| Pod runs but plugin not in nav | Plugin not registered in `console.operator.openshift.io/cluster` | Re-run step 4, then `oc -n openshift-console rollout restart deploy/console` |
| "Open in Grafana" disabled | Default route `rhcl-grafana/rhcl-grafana-route` not found | Install the Grafana automation or set the ConfigMap in [configuration.md](configuration.md) |

## Removing the plugin

```bash
# Remove the plugin from the console operator
oc get console.operator.openshift.io cluster -o json \
  | jq '.spec.plugins = [.spec.plugins[] | select(. != "kuadrant-console")]' \
  | oc apply -f -

oc delete consoleplugin kuadrant-console

# Delete the workload + Service (service-CA cleans the cert Secret automatically)
oc delete deployment,service,configmap \
  -n kuadrant-console -l app=kuadrant-console
oc delete configmap kuadrant-console-config -n kuadrant-console --ignore-not-found
oc delete project kuadrant-console
```

API-key Secrets in your application namespaces are owned by your app, not the
plugin — leave them in place when removing only the plugin.

## RBAC requirements

The plugin carries **no service-account token** (NFR-001). Every API call uses
the signed-in user's bearer token via the Console's built-in proxy, so users
see only what their cluster RBAC allows.

| Persona | Minimum RBAC |
|---|---|
| Platform SRE | `cluster-admin`, or namespace-scoped admin across gateway/app namespaces |
| App team operator | `view`/`edit` on their app namespace + `get` on the gateway namespace |
| API product owner | `view` on app namespaces |
| PoC reviewer | `view` cluster-wide |

Additionally, **any signed-in user** needs these reads to resolve deep links
and runtime config (they default to `system:authenticated` on a stock cluster;
grant explicitly only on clusters with restrictive default RBAC):

| Resource | Verb | Why |
|---|---|---|
| `routes` in `rhcl-grafana` (or override ns) | `get`, `watch` | "Open in Grafana" URL |
| `routes` in `tempo` (or override ns) | `get`, `watch` | "View trace" URL |
| `tempostacks` in `tempo` | `get`, `watch` | Tempo gateway tenant name |
| `configmaps` (`kuadrant-console-config`) | `get`, `watch` | Runtime configuration overrides |
