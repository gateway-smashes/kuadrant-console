import * as React from 'react';
// SDK 4.21 federates react-router 5.3; keep the v5 Link import until SDK 4.22+.
import { Link } from 'react-router-dom';
import {
  PageSection,
  Title,
  Spinner,
  Bullseye,
  Label,
  Flex,
  FlexItem,
  Button,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { MCPServerRegistrationGVK } from '../../models';
import { MCPServerRegistration, mcpPrefix, mcpReadiness } from '../../types';
import StatusLabel from '../common/StatusLabel';
import FilterToolbar from '../common/FilterToolbar';
import ResourceActionsMenu from '../common/ResourceActionsMenu';
import AddMCPGatewayWizard from './AddMCPGatewayWizard';
import '../../styles/plugin-glass.css';

/**
 * Lists every `MCPServerRegistration` (mcp.kuadrant.io/v1) on the cluster — the
 * backend MCP servers federated behind the Kuadrant MCP Gateway broker. Each row
 * shows the tool prefix the broker publishes under, the HTTPRoute that reaches
 * the backend, and readiness. The federated tool *list* is not on the CR (it
 * lives in the broker's aggregated config) — surfacing it is the Phase 2
 * playground, which queries the broker's `tools/list`.
 */
const MCPServersListPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const [searchValue, setSearchValue] = React.useState('');
  const [selectedNamespace, setSelectedNamespace] = React.useState('');
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const [servers, loaded] = useK8sWatchResource<MCPServerRegistration[]>({
    groupVersionKind: MCPServerRegistrationGVK,
    isList: true,
  });

  const namespaces = React.useMemo(
    () => [...new Set((servers || []).map((s) => s.metadata?.namespace || ''))].sort(),
    [servers],
  );

  const filtered = React.useMemo(() => {
    let items = servers || [];
    if (selectedNamespace) {
      items = items.filter((s) => s.metadata?.namespace === selectedNamespace);
    }
    if (searchValue) {
      const lower = searchValue.toLowerCase();
      items = items.filter((s) => {
        const name = (s.metadata?.name || '').toLowerCase();
        const prefix = mcpPrefix(s).toLowerCase();
        return name.includes(lower) || prefix.includes(lower);
      });
    }
    return items;
  }, [servers, selectedNamespace, searchValue]);

  if (!loaded) {
    return (
      <div className="rhcl-plugin-root">
        <PageSection variant="default">
          <Title headingLevel="h1">{t('MCP Servers')}</Title>
        </PageSection>
        <PageSection isFilled>
          <Bullseye>
            <Spinner size="xl" />
          </Bullseye>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="rhcl-plugin-root">
      <PageSection variant="default">
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1">{t('MCP Servers')}</Title>
            <p style={{ marginTop: 4, color: 'var(--pf-t--global--color--nonstatus--gray--default)' }}>
              {t(
                'MCP servers registered behind the Kuadrant MCP Gateway. The broker federates each server’s tools under its prefix.',
              )}
            </p>
          </FlexItem>
          <FlexItem>
            <Button variant="primary" onClick={() => setWizardOpen(true)}>
              {t('Add MCP Gateway')}
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection>
        <FilterToolbar
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder={t('Search by name or prefix')}
          namespaces={namespaces}
          selectedNamespace={selectedNamespace}
          onNamespaceChange={setSelectedNamespace}
        />
        {filtered.length === 0 ? (
          <EmptyState headingLevel="h2" titleText={t('No MCP servers found')}>
            <EmptyStateBody>
              {t(
                'Register an MCP server with an MCPServerRegistration (mcp.kuadrant.io/v1) whose targetRef points to the HTTPRoute that reaches it. It appears here once the controller reconciles it.',
              )}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label={t('MCP Servers')}>
            <Thead>
              <Tr>
                <Th>{t('Name')}</Th>
                <Th>{t('Namespace')}</Th>
                <Th>{t('Prefix')}</Th>
                <Th>{t('Path')}</Th>
                <Th>{t('Backend route')}</Th>
                <Th>{t('State')}</Th>
                <Th>{t('Status')}</Th>
                <Th aria-label={t('Actions')} />
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((s) => {
                const ns = s.metadata?.namespace || '';
                const name = s.metadata?.name || '';
                const prefix = mcpPrefix(s);
                const ready = mcpReadiness(s);
                const ref = s.spec?.targetRef;
                const routeNs = ref?.namespace || ns;
                return (
                  <Tr key={s.metadata?.uid}>
                    <Td>
                      <Link to={`/connectivity-link/mcp-servers/${ns}/${name}`}>{name}</Link>
                    </Td>
                    <Td>{ns}</Td>
                    <Td>{prefix ? <code>{prefix}</code> : <DimDash />}</Td>
                    <Td>
                      <code>{s.spec?.path || '/mcp'}</code>
                    </Td>
                    <Td>
                      {ref?.name ? (
                        (ref.kind || 'HTTPRoute') === 'HTTPRoute' ? (
                          <Link to={`/connectivity-link/httproutes/${routeNs}/${ref.name}`}>
                            {ref.name}
                          </Link>
                        ) : (
                          <>
                            {ref.kind}/{ref.name}
                          </>
                        )
                      ) : (
                        <DimDash />
                      )}
                    </Td>
                    <Td>
                      <Label color={s.spec?.state === 'Disabled' ? 'grey' : 'blue'} isCompact>
                        {s.spec?.state || 'Enabled'}
                      </Label>
                    </Td>
                    <Td>
                      <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                        <FlexItem>
                          <Label color={ready.color} isCompact>
                            {t(ready.label)}
                          </Label>
                        </FlexItem>
                        <FlexItem>
                          <StatusLabel conditions={s.status?.conditions} />
                        </FlexItem>
                      </Flex>
                    </Td>
                    <Td isActionCell>
                      <ResourceActionsMenu
                        gvk={MCPServerRegistrationGVK}
                        namespace={ns}
                        name={name}
                        listHref="/connectivity-link/mcp-servers"
                        resource={s}
                        plural="mcpserverregistrations"
                      />
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>
      <AddMCPGatewayWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
};

function DimDash() {
  return <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</span>;
}

export default MCPServersListPage;
