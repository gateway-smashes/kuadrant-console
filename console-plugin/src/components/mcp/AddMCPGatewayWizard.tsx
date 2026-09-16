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
  Switch,
  Alert,
  Progress,
  ProgressSize,
  Label,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { dump } from 'js-yaml';
import { k8sCreate } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  McpGatewayWizardState,
  defaultMcpWizardState,
  generateAllMcp,
  GeneratedMcpResource,
} from './mcpWizardManifests';
import '../../styles/plugin-glass.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = ['Gateway', 'MCP server', 'Review & create'] as const;

interface CreateResult {
  res: GeneratedMcpResource;
  status: 'created' | 'exists' | 'error';
  message?: string;
}

/**
 * "Add MCP Gateway" — a guided, step-by-step flow that stands up the MCP
 * Gateway resources (Gateway with the mcp/mcps listeners → MCPGatewayExtension
 * → optional first MCPServerRegistration) from one state object, then applies
 * them with k8sCreate. Same one-source-of-truth manifests power the Review YAML
 * and the create loop.
 *
 * Note: the broker Deployment, the /mcp HTTPRoute and the EnvoyFilter are
 * created by the MCP controller once the MCPGatewayExtension goes Ready — this
 * wizard creates the declarative inputs, the operator does the rest.
 */
const AddMCPGatewayWizard: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<McpGatewayWizardState>(defaultMcpWizardState());
  const [phase, setPhase] = React.useState<'editing' | 'creating' | 'done'>('editing');
  const [results, setResults] = React.useState<CreateResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setState(defaultMcpWizardState());
    setPhase('editing');
    setResults([]);
    setError(null);
  }, [isOpen]);

  const set = <K extends keyof McpGatewayWizardState>(k: K, v: McpGatewayWizardState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const resources = React.useMemo(() => generateAllMcp(state), [state]);

  // Per-step validation — the Next/Create button only enables on valid input.
  const stepValid = React.useMemo(() => {
    if (step === 0) {
      return state.createGateway
        ? !!(state.gatewayName && state.gatewayNamespace && state.gatewayClassName)
        : !!state.gatewayName && !!state.gatewayNamespace;
    }
    if (step === 1) {
      return !state.registerServer
        ? true
        : !!(state.serverName && state.serverNamespace && state.routeName);
    }
    return true;
  }, [step, state]);

  const create = async () => {
    setPhase('creating');
    setError(null);
    const out: CreateResult[] = [];
    for (const res of resources) {
      try {
        await k8sCreate<{ apiVersion: string; kind: string }>({
          model: {
            apiGroup: res.apiGroup,
            apiVersion: res.apiVersion,
            kind: res.kind,
            plural: res.plural,
            abbr: res.kind.slice(0, 2).toUpperCase(),
            label: res.kind,
            labelPlural: res.plural,
            namespaced: true,
          },
          data: res.manifest as { apiVersion: string; kind: string },
        });
        out.push({ res, status: 'created' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists|alreadyexists|409/i.test(msg)) {
          out.push({ res, status: 'exists' });
        } else {
          out.push({ res, status: 'error', message: msg });
          setResults([...out]);
          setError(
            t('Failed creating {{kind}} {{name}}: {{msg}}', {
              kind: res.kind,
              name: res.name,
              msg,
            }),
          );
          setPhase('done');
          return;
        }
      }
      setResults([...out]);
    }
    setPhase('done');
  };

  const footer =
    phase === 'done' ? (
      <Button variant="primary" onClick={onClose}>
        {t('Close')}
      </Button>
    ) : (
      <>
        <Button
          variant="primary"
          isDisabled={!stepValid || phase === 'creating'}
          isLoading={phase === 'creating' && step === STEPS.length - 1}
          onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : create())}
        >
          {step < STEPS.length - 1 ? t('Next') : t('Create')}
        </Button>
        <Button variant="secondary" isDisabled={step === 0 || phase === 'creating'} onClick={() => setStep(step - 1)}>
          {t('Back')}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={phase === 'creating'}>
          {t('Cancel')}
        </Button>
      </>
    );

  return (
    <Modal variant={ModalVariant.large} isOpen={isOpen} onClose={onClose} aria-label={t('Add MCP Gateway')}>
      <ModalHeader title={t('Add MCP Gateway')} />
      <ModalBody>
        {/* step rail */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {STEPS.map((label, i) => (
            <Label
              key={label}
              color={i === step ? 'blue' : i < step ? 'green' : 'grey'}
              isCompact
            >
              {i + 1}. {t(label)}
            </Label>
          ))}
        </div>

        {phase === 'done' ? (
          <CreateSummary results={results} error={error} t={t} />
        ) : (
          <>
            {step === 0 && <GatewayStep state={state} set={set} t={t} />}
            {step === 1 && <ServerStep state={state} set={set} t={t} />}
            {step === 2 && <ReviewStep resources={resources} t={t} />}
            {phase === 'creating' && (
              <Progress
                value={(results.length / Math.max(1, resources.length)) * 100}
                title={t('Creating resources…')}
                size={ProgressSize.sm}
                style={{ marginTop: 16 }}
              />
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>{footer}</ModalFooter>
    </Modal>
  );
};

type SetFn = <K extends keyof McpGatewayWizardState>(k: K, v: McpGatewayWizardState[K]) => void;
type TFn = (key: string, opts?: Record<string, unknown>) => string;

const GatewayStep: React.FC<{ state: McpGatewayWizardState; set: SetFn; t: TFn }> = ({ state, set, t }) => (
  <Form>
    <Switch
      id="mcp-create-gw"
      label={t('Create a new Gateway (with the mcp / mcps listeners)')}
      isChecked={state.createGateway}
      onChange={(_e, v) => set('createGateway', v)}
    />
    <FormGroup label={t('Gateway name')} isRequired fieldId="mcp-gw-name">
      <TextInput id="mcp-gw-name" value={state.gatewayName} onChange={(_e, v) => set('gatewayName', v)} />
    </FormGroup>
    <FormGroup label={t('Gateway namespace')} isRequired fieldId="mcp-gw-ns">
      <TextInput id="mcp-gw-ns" value={state.gatewayNamespace} onChange={(_e, v) => set('gatewayNamespace', v)} />
    </FormGroup>
    {state.createGateway && (
      <>
        <FormGroup label={t('GatewayClass')} isRequired fieldId="mcp-gw-class">
          <TextInput id="mcp-gw-class" value={state.gatewayClassName} onChange={(_e, v) => set('gatewayClassName', v)} />
        </FormGroup>
        <FormGroup
          label={t('Public MCP host')}
          fieldId="mcp-gw-host"
        >
          <TextInput
            id="mcp-gw-host"
            value={state.publicHost}
            onChange={(_e, v) => set('publicHost', v)}
            placeholder="mcp.apps.<your-cluster-domain>"
          />
        </FormGroup>
        <FormGroup label={t('Listener port')} fieldId="mcp-gw-port">
          <TextInput
            id="mcp-gw-port"
            type="number"
            value={String(state.port)}
            onChange={(_e, v) => set('port', parseInt(v, 10) || 8080)}
          />
        </FormGroup>
      </>
    )}
    <p style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
      {t(
        'An MCPGatewayExtension is created targeting this gateway’s "mcp" listener; the MCP controller then provisions the broker, the /mcp route and the EnvoyFilter.',
      )}
    </p>
  </Form>
);

const ServerStep: React.FC<{ state: McpGatewayWizardState; set: SetFn; t: TFn }> = ({ state, set, t }) => (
  <Form>
    <Switch
      id="mcp-register"
      label={t('Register a first MCP server now')}
      isChecked={state.registerServer}
      onChange={(_e, v) => set('registerServer', v)}
    />
    {state.registerServer ? (
      <>
        <FormGroup label={t('Server name')} isRequired fieldId="mcp-srv-name">
          <TextInput id="mcp-srv-name" value={state.serverName} onChange={(_e, v) => set('serverName', v)} />
        </FormGroup>
        <FormGroup label={t('Namespace')} isRequired fieldId="mcp-srv-ns">
          <TextInput id="mcp-srv-ns" value={state.serverNamespace} onChange={(_e, v) => set('serverNamespace', v)} />
        </FormGroup>
        <FormGroup label={t('Tool prefix')} fieldId="mcp-srv-prefix">
          <TextInput
            id="mcp-srv-prefix"
            value={state.prefix}
            onChange={(_e, v) => set('prefix', v)}
            placeholder="myserver_"
          />
        </FormGroup>
        <FormGroup label={t('Backend HTTPRoute name')} isRequired fieldId="mcp-srv-route">
          <TextInput
            id="mcp-srv-route"
            value={state.routeName}
            onChange={(_e, v) => set('routeName', v)}
            placeholder="my-server-route"
          />
        </FormGroup>
        <p style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
          {t(
            'The HTTPRoute must already exist and attach to the gateway’s "mcps" listener, routing to your backend MCP server.',
          )}
        </p>
      </>
    ) : (
      <p style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
        {t('Skip for now — register MCP servers later from the MCP Servers list.')}
      </p>
    )}
  </Form>
);

const ReviewStep: React.FC<{ resources: GeneratedMcpResource[]; t: TFn }> = ({ resources, t }) => (
  <div>
    <p style={{ marginBottom: 12 }}>
      {t('These {{n}} resources will be created:', { n: resources.length })}
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      {resources.map((r) => (
        <Label key={`${r.kind}/${r.name}`} color="blue" isCompact>
          {r.kind} · {r.name}
        </Label>
      ))}
    </div>
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto', border: '1px solid var(--pf-t--global--border--color--default)', borderRadius: 8 }}>
      <pre style={{ margin: 0, padding: 14, fontSize: 12, lineHeight: 1.5 }}>
        {resources.map((r) => `---\n${dump(r.manifest)}`).join('')}
      </pre>
    </div>
  </div>
);

const CreateSummary: React.FC<{ results: CreateResult[]; error: string | null; t: TFn }> = ({
  results,
  error,
  t,
}) => (
  <div>
    {error ? (
      <Alert variant="danger" isInline title={t('Something went wrong')} style={{ marginBottom: 12 }}>
        {error}
      </Alert>
    ) : (
      <Alert variant="success" isInline title={t('MCP Gateway resources applied')} style={{ marginBottom: 12 }} />
    )}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {results.map((r) => (
        <div key={`${r.res.kind}/${r.res.name}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {r.status === 'error' ? (
            <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default)" />
          ) : (
            <CheckCircleIcon color="var(--pf-t--global--color--status--success--default)" />
          )}
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
            {r.res.kind} · {r.res.name}
          </span>
          <Label isCompact color={r.status === 'created' ? 'green' : r.status === 'exists' ? 'grey' : 'red'}>
            {t(r.status)}
          </Label>
          {r.message && <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>{r.message}</span>}
        </div>
      ))}
    </div>
    <p style={{ marginTop: 16, fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
      {t('The broker and /mcp route are provisioned by the controller once the MCPGatewayExtension is Ready.')}
    </p>
  </div>
);

export default AddMCPGatewayWizard;
