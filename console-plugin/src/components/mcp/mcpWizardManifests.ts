/**
 * Manifest generators for the "Add MCP Gateway" wizard — pure functions
 * McpGatewayWizardState → K8s objects, mirroring the Create-API wizard's
 * one-source-of-truth pattern (the same list feeds the review YAML and the
 * final k8sCreate loop). Every generator returns `null` when the step says the
 * resource should not be created, so callers `filter(Boolean)`.
 *
 * MCP resources are `mcp.kuadrant.io/v1` — GA in RHCL 1.5, which serves v1 and
 * no longer serves v1alpha1 (verified on-cluster). The older standalone
 * mcp-gateway 0.7.x chart served v1alpha1 only.
 */

export interface McpGatewayWizardState {
  // --- Gateway (the MCP listeners) ---
  createGateway: boolean;
  gatewayName: string;
  gatewayNamespace: string;
  gatewayClassName: string;
  /** Public host clients use to reach the broker (the `mcp` listener). */
  publicHost: string;
  /** Listener port (Istio MCP gateways use 8080 by convention). */
  port: number;
  // --- Register a first MCP server (optional) ---
  registerServer: boolean;
  serverName: string;
  serverNamespace: string;
  /** Tool prefix — the broker republishes the server's tools under this. */
  prefix: string;
  /** Name of the existing HTTPRoute (on the `mcps` listener) that reaches the server. */
  routeName: string;
  /** `/mcp` by default. */
  path: string;
}

export interface GeneratedMcpResource {
  kind: string;
  name: string;
  namespace: string;
  apiGroup: string;
  apiVersion: string;
  plural: string;
  manifest: Record<string, unknown>;
}

export function defaultMcpWizardState(namespace = 'mcp-system'): McpGatewayWizardState {
  return {
    createGateway: true,
    gatewayName: 'mcp-gateway',
    gatewayNamespace: 'gateway-system',
    gatewayClassName: 'istio',
    publicHost: '',
    port: 8080,
    registerServer: false,
    serverName: '',
    serverNamespace: namespace,
    prefix: '',
    routeName: '',
    path: '/mcp',
  };
}

/**
 * The Gateway carrying the two MCP listeners: `mcp` (client-facing, the broker
 * attaches here) and `mcps` (internal wildcard the MCP server HTTPRoutes attach
 * to; the Envoy MCP Router resolves it). Skipped when attaching to an existing
 * gateway.
 */
export function genMcpGateway(s: McpGatewayWizardState): GeneratedMcpResource | null {
  if (!s.createGateway) return null;
  return {
    kind: 'Gateway',
    name: s.gatewayName,
    namespace: s.gatewayNamespace,
    apiGroup: 'gateway.networking.k8s.io',
    apiVersion: 'v1',
    plural: 'gateways',
    manifest: {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: {
        name: s.gatewayName,
        namespace: s.gatewayNamespace,
        labels: { 'gateway.io/name': s.gatewayName },
      },
      spec: {
        gatewayClassName: s.gatewayClassName,
        listeners: [
          {
            name: 'mcp',
            ...(s.publicHost ? { hostname: s.publicHost } : {}),
            port: s.port,
            protocol: 'HTTP',
            allowedRoutes: { namespaces: { from: 'All' } },
          },
          {
            name: 'mcps',
            hostname: '*.mcp.local',
            port: s.port,
            protocol: 'HTTP',
            allowedRoutes: { namespaces: { from: 'All' } },
          },
        ],
      },
    },
  };
}

/**
 * MCPGatewayExtension — attaches the broker/router to the gateway's `mcp`
 * listener. The controller then creates the broker Deployment, the `/mcp`
 * HTTPRoute, and the EnvoyFilter.
 */
export function genMcpGatewayExtension(s: McpGatewayWizardState): GeneratedMcpResource {
  return {
    kind: 'MCPGatewayExtension',
    name: s.gatewayName,
    namespace: s.gatewayNamespace,
    apiGroup: 'mcp.kuadrant.io',
    apiVersion: 'v1',
    plural: 'mcpgatewayextensions',
    manifest: {
      apiVersion: 'mcp.kuadrant.io/v1',
      kind: 'MCPGatewayExtension',
      metadata: { name: s.gatewayName, namespace: s.gatewayNamespace },
      spec: {
        ...(s.publicHost ? { publicHost: s.publicHost } : {}),
        httpRouteManagement: 'Enabled',
        targetRef: {
          group: 'gateway.networking.k8s.io',
          kind: 'Gateway',
          name: s.gatewayName,
          namespace: s.gatewayNamespace,
          sectionName: 'mcp',
        },
      },
    },
  };
}

/**
 * MCPServerRegistration — registers a backend MCP server (via its HTTPRoute)
 * under a tool prefix. Only when the wizard's "register a server" step is on.
 */
export function genMcpServerRegistration(s: McpGatewayWizardState): GeneratedMcpResource | null {
  if (!s.registerServer) return null;
  return {
    kind: 'MCPServerRegistration',
    name: s.serverName,
    namespace: s.serverNamespace,
    apiGroup: 'mcp.kuadrant.io',
    apiVersion: 'v1',
    plural: 'mcpserverregistrations',
    manifest: {
      apiVersion: 'mcp.kuadrant.io/v1',
      kind: 'MCPServerRegistration',
      metadata: {
        name: s.serverName,
        namespace: s.serverNamespace,
        labels: { 'mcp.kuadrant.io/managed': 'true' },
      },
      spec: {
        ...(s.prefix ? { prefix: s.prefix } : {}),
        path: s.path || '/mcp',
        state: 'Enabled',
        targetRef: {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: s.routeName,
        },
      },
    },
  };
}

/** The full ordered set the wizard will create. */
export function generateAllMcp(s: McpGatewayWizardState): GeneratedMcpResource[] {
  return [genMcpGateway(s), genMcpGatewayExtension(s), genMcpServerRegistration(s)].filter(
    (r): r is GeneratedMcpResource => r !== null,
  );
}
