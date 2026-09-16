import * as React from 'react';
import { Card, CardTitle, CardBody } from '@patternfly/react-core';
import { DnsTimelineEvent, STATUS_META } from './types';

/**
 * Reconciliation timeline — a vertical list of the DNSPolicy / Gateway /
 * HTTPRoute Events, most recent last, with a colour dot per row. The
 * point isn't to be a full log viewer: 10-15 lines that answer "what
 * happened and in what order" so the operator doesn't have to reach
 * for `oc get events`.
 */

interface Props {
  events: DnsTimelineEvent[];
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const DNSTimeline: React.FC<Props> = ({ events }) => (
  <Card aria-label="Reconciliation timeline">
    <CardTitle>Reconciliation timeline</CardTitle>
    <CardBody>
      {events.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--pf-t--global--text--color--subtle)' }}>
          No recent Events for this DNSPolicy / Gateway / HTTPRoute. That usually means
          reconciliation is idle — inspect the Advanced section for raw conditions.
        </div>
      ) : (
        <ol className="rhcl-dns-timeline">
          {events.map((e, i) => (
            // DOM order MUST match the grid columns declared in
            // dns-troubleshooting.css (`56px 16px 1fr` = time, dot, body).
            // Rendering the dot first pushed the timestamp into the 16px
            // dot column, where "02:24 AM" wrapped and overlapped the
            // title — the overlap the operator reported.
            <li key={`${e.when}-${i}`}>
              <span className="rhcl-dns-timeline-time">{formatTime(e.when)}</span>
              <span
                className="rhcl-dns-timeline-dot"
                style={{ backgroundColor: STATUS_META[e.status].color }}
                aria-hidden="true"
              />
              <div className="rhcl-dns-timeline-body">
                <div className="rhcl-dns-timeline-title">{e.title}</div>
                {e.detail && <div className="rhcl-dns-timeline-detail">{e.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </CardBody>
  </Card>
);

export default DNSTimeline;
