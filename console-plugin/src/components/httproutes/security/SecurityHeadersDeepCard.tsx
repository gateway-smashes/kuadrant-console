import * as React from 'react';
import {
  Card,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Button,
  Spinner,
  Alert,
  Icon,
  TextInput,
  InputGroup,
  InputGroupItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core';
import { RedoIcon } from '@patternfly/react-icons';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { CheckStatusLabel } from './SecurityAtoms';
import { HeadersProbeSnapshot } from './routeSecurityTypes';

interface Props {
  configured: boolean;
  loading: boolean;
  error: string | null;
  snapshot: HeadersProbeSnapshot | null;
  defaultUrl: string;
  onRun: (url: string) => void;
}

/**
 * Deep-dive Security Headers card for the Security tab. Renders the same
 * probe as the Details tab's compact card but with:
 *   - editable URL (default: https://<hostname>/)
 *   - per-header status + value table
 *   - probe metadata (URL, HTTP status, latency)
 *   - install callout when the prober is absent
 */
export const SecurityHeadersDeepCard: React.FC<Props> = ({
  configured,
  loading,
  error,
  snapshot,
  defaultUrl,
  onRun,
}) => {
  const [url, setUrl] = React.useState(defaultUrl);
  React.useEffect(() => {
    setUrl((prev) => (prev ? prev : defaultUrl));
  }, [defaultUrl]);

  return (
    <Card>
      <CardTitle>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>Security Headers</FlexItem>
          {configured && (
            <FlexItem>
              <Button
                variant="secondary"
                onClick={() => onRun(url || defaultUrl)}
                isDisabled={loading || !url}
                icon={loading ? <Spinner size="sm" /> : <Icon><RedoIcon /></Icon>}
              >
                {loading ? 'Probing…' : 'Run check'}
              </Button>
            </FlexItem>
          )}
        </Flex>
      </CardTitle>
      <CardBody>
        {!configured ? (
          <Alert isInline variant="info" title="dns-prober companion not installed">
            Install the dns-prober companion to probe live security response headers
            (HSTS, CSP, X-Frame-Options, …) from inside the cluster. Without it, the
            plugin cannot bypass the browser CORS restriction that hides response
            headers from cross-origin fetches.
          </Alert>
        ) : (
          <>
            <InputGroup style={{ marginBottom: 12 }}>
              <InputGroupItem isFill>
                <TextInput
                  aria-label="URL to probe"
                  value={url}
                  onChange={(_, v) => setUrl(v)}
                  placeholder={defaultUrl}
                />
              </InputGroupItem>
            </InputGroup>
            {error && (
              <Alert isInline variant="warning" title="Probe failed">
                {error}
              </Alert>
            )}
            {snapshot ? (
              <>
                <DescriptionList isCompact isHorizontal style={{ marginBottom: 12 }}>
                  <DescriptionListGroup>
                    <DescriptionListTerm>URL</DescriptionListTerm>
                    <DescriptionListDescription>
                      <code>{snapshot.url}</code>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>HTTP status</DescriptionListTerm>
                    <DescriptionListDescription>{snapshot.httpStatus ?? '-'}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Latency</DescriptionListTerm>
                    <DescriptionListDescription>{snapshot.latencyMs ?? '-'} ms</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Probed at</DescriptionListTerm>
                    <DescriptionListDescription>{snapshot.probedAt}</DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
                <Table aria-label="Security response headers" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Header</Th>
                      <Th>Status</Th>
                      <Th>Value</Th>
                      <Th>Detail</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {snapshot.headers.map((h) => (
                      <Tr key={h.id}>
                        <Td>{h.header}</Td>
                        <Td>
                          <CheckStatusLabel status={h.status} />
                        </Td>
                        <Td>
                          {h.present ? <code style={{ wordBreak: 'break-all' }}>{h.value || '(present)'}</code> : '—'}
                        </Td>
                        <Td>{h.detail}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
                Click Run check to probe security response headers for {defaultUrl}.
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
};
