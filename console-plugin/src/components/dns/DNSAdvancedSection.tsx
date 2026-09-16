import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardTitle,
  CardBody,
  ExpandableSection,
  Content,
  Label,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
} from '@patternfly/react-table';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { STATUS_META } from './types';

/**
 * Power-user drawer at the bottom of the page. Reads the raw
 * `status.conditions[]` off the three CRs and renders one small table
 * per object with type / status / reason / last-transition. Also
 * carries deep-links into Console's native YAML editor for each CR —
 * for when the operator needs to look at the whole shape or hand-edit
 * a field the guided cards don't surface.
 *
 * Kept collapsed by default: the page's core promise is "read this in
 * <30 seconds without touching YAML." Advanced is opt-in.
 */

interface RawCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

interface Obj {
  kind: string;
  group?: string;
  version: string;
  name?: string;
  namespace?: string;
  conditions?: RawCondition[];
}

interface Props {
  objects: Obj[];
}

function statusIcon(s?: string) {
  if (s === 'True') return <CheckCircleIcon style={{ color: STATUS_META.healthy.color, fontSize: 12 }} />;
  if (s === 'False') return <ExclamationCircleIcon style={{ color: STATUS_META.failing.color, fontSize: 12 }} />;
  return null;
}

function yamlHref(o: Obj): string | null {
  if (!o.name || !o.namespace) return null;
  const groupToken = o.group || 'core';
  return `/k8s/ns/${o.namespace}/${groupToken}~${o.version}~${o.kind}/${o.name}/yaml`;
}

const DNSAdvancedSection: React.FC<Props> = ({ objects }) => {
  const [expanded, setExpanded] = React.useState(false);
  // Filter out objects the flow doesn't actually have (e.g. no
  // DNSPolicy matched). Rendering a "conditions: none" row for a
  // missing CR would be misleading.
  const present = objects.filter((o) => o.name);
  return (
    <Card aria-label="Advanced">
      <CardTitle>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Advanced
          <Label color="grey" isCompact>Raw status conditions</Label>
        </span>
      </CardTitle>
      <CardBody>
        <ExpandableSection
          toggleText={expanded ? 'Hide raw status' : 'Show raw status'}
          isExpanded={expanded}
          onToggle={(_e, v) => setExpanded(v)}
          isIndented={false}
        >
          {present.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
              None of the pipeline CRs exist yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {present.map((o) => (
                <div key={`${o.kind}/${o.namespace}/${o.name}`}>
                  <Content>
                    <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>
                      {o.kind}{' '}
                      <code style={{ fontWeight: 400 }}>{o.namespace}/{o.name}</code>
                      {yamlHref(o) && (
                        <>
                          {' '}
                          <Link to={yamlHref(o)!} style={{ fontSize: 12, marginLeft: 6 }}>
                            open YAML
                          </Link>
                        </>
                      )}
                    </h4>
                  </Content>
                  {(!o.conditions || o.conditions.length === 0) ? (
                    <div style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                      No conditions on status yet.
                    </div>
                  ) : (
                    <Table aria-label={`${o.kind} conditions`} variant="compact" borders={false}>
                      <Thead>
                        <Tr>
                          <Th width={20}>Type</Th>
                          <Th width={10}>Status</Th>
                          <Th width={20}>Reason</Th>
                          <Th>Message</Th>
                          <Th width={20}>Last transition</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {o.conditions.map((c, i) => (
                          <Tr key={i}>
                            <Td>{c.type || '—'}</Td>
                            <Td>
                              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                {statusIcon(c.status)}
                                {c.status || '—'}
                              </span>
                            </Td>
                            <Td>
                              <code style={{ fontSize: 12 }}>{c.reason || '—'}</code>
                            </Td>
                            <Td>
                              <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                                {c.message || '—'}
                              </span>
                            </Td>
                            <Td>
                              <span style={{ fontSize: 12, color: 'var(--pf-t--global--text--color--subtle)' }}>
                                {c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '—'}
                              </span>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </div>
              ))}
            </div>
          )}
        </ExpandableSection>
      </CardBody>
    </Card>
  );
};

export default DNSAdvancedSection;
