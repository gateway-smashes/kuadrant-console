import * as React from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Gallery,
  GalleryItem,
  Label,
  LabelGroup,
  Progress,
  ProgressMeasureLocation,
  ProgressSize,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { RateLimit, counterText } from '../../types';

/**
 * Shared rate-limit visualizer.
 *
 * One component, three use sites: the API Product "Plans" tab, the new
 * RateLimitPolicy detail page, and the inline expansion in
 * PolicyAttachmentView. The data shape is the Kuadrant `RateLimit` value
 * (rates[] + when[]), keyed by a name (tier / limit name).
 *
 * The visual emphasis is the *rate* — what's the cap and over what window —
 * because that's the answer most viewers come here looking for. Secondary
 * surfaces (predicate, counters, equivalences) are pills/lines below.
 */

export type RateLimitEntries = Record<string, RateLimit>;

export interface RateLimitVisualizerProps {
  /** Limits to render, keyed by name (e.g. "gold", "silver", "global-burst"). */
  limits: RateLimitEntries;
  /**
   * Variant — controls density:
   *   - "cards": full cards (default, used in policy detail + plans tab)
   *   - "compact": dense rows (used in PolicyAttachmentView inline expansion)
   */
  variant?: 'cards' | 'compact';
  /** Optional source policy ref shown below each card ("From: rlp/foo"). */
  sourceLabel?: string;
  /** Optional source policy link (Console URL). */
  sourceHref?: string;
  /**
   * Optional comparison anchor — a "Reference" rate (req/min) used to draw
   * relative-strength bars across cards. Default = max rpm across `limits`.
   */
  compareAgainstRpm?: number;
}

// ---------------------------------------------------------------------------
// Helpers — convert Kuadrant's "10 per 1m" rate into a single per-minute
// figure so we can compare tiers visually and synthesize day/month estimates.
// ---------------------------------------------------------------------------

/** Returns window length in seconds. Tolerates "10s", "1m", "2h", "1d". */
export function windowToSeconds(window: string): number {
  const m = /^(\d+)([smhd])?$/.exec(window.trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  switch (m[2] || 's') {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return NaN;
  }
}

/** Best-case requests per minute, picking the tightest rate when there are several. */
export function ratesToRpm(rates: RateLimit['rates']): number | undefined {
  if (!rates || rates.length === 0) return undefined;
  let bestRpm = Infinity;
  for (const r of rates) {
    const secs = windowToSeconds(r.window);
    if (!Number.isFinite(secs) || secs <= 0) continue;
    const rpm = (r.limit / secs) * 60;
    if (rpm < bestRpm) bestRpm = rpm;
  }
  return Number.isFinite(bestRpm) ? bestRpm : undefined;
}

/** Pretty number — "1,250", "1.2k", "2M". Optimised for readability over precision. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function predicateText(w: NonNullable<RateLimit['when']>[number]): string {
  if ('predicate' in w) return w.predicate;
  return `${w.selector} ${w.operator}${w.value !== undefined ? ' ' + w.value : ''}`;
}

// Map common tier names to PatternFly Label colours so gold/silver/bronze
// land with their intuitive shades wherever they appear.
// PatternFly's Label palette has no `gold`/`silver`/`bronze` — pick the
// closest semantic colour from the supported set so the tier still reads
// as itself (yellow ≈ gold, grey ≈ silver, orange ≈ bronze).
function tierLabelColor(name: string): 'yellow' | 'grey' | 'orange' | 'blue' {
  const lower = name.toLowerCase();
  if (lower.includes('gold')) return 'yellow';
  if (lower.includes('silver')) return 'grey';
  if (lower.includes('bronze') || lower.includes('copper')) return 'orange';
  return 'blue';
}

// ---------------------------------------------------------------------------
// Card subcomponent
// ---------------------------------------------------------------------------

const LimitCard: React.FC<{
  name: string;
  limit: RateLimit;
  maxRpm: number;
  sourceLabel?: string;
  sourceHref?: string;
}> = ({ name, limit, maxRpm, sourceLabel, sourceHref }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const rpm = ratesToRpm(limit.rates);
  const unlimited = rpm === undefined;
  const dailyEst = rpm !== undefined ? rpm * 60 * 24 : undefined;
  const monthlyEst = dailyEst !== undefined ? dailyEst * 30 : undefined;
  const pct = unlimited
    ? 100
    : Math.min(100, Math.round(((rpm as number) / Math.max(maxRpm, 1)) * 100));

  return (
    <Card isCompact isFullHeight>
      <CardTitle>
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Label color={tierLabelColor(name)} isCompact>{name}</Label>
          </FlexItem>
          {unlimited && (
            <FlexItem>
              <Label color="purple" isCompact>{t('Unlimited')}</Label>
            </FlexItem>
          )}
        </Flex>
      </CardTitle>
      <CardBody>
        {/* Hero metric */}
        <div style={{ marginBottom: 12 }}>
          {unlimited ? (
            <Title headingLevel="h2" size="2xl">∞</Title>
          ) : (
            <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsBaseline' }}>
              <FlexItem>
                <Title headingLevel="h2" size="2xl" style={{ display: 'inline' }}>
                  {compact(rpm as number)}
                </Title>
              </FlexItem>
              <FlexItem>
                <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>{t('req/min')}</span>
              </FlexItem>
            </Flex>
          )}
        </div>

        {/* Relative-strength bar */}
        {!unlimited && maxRpm > 0 && (
          <Progress
            value={pct}
            size={ProgressSize.sm}
            measureLocation={ProgressMeasureLocation.none}
            aria-label={t('Relative rate')}
            style={{ marginBottom: 12 }}
          />
        )}

        {/* Raw rates — show ALL of them in case there are multiple */}
        {limit.rates && limit.rates.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--pf-v5-global--Color--200)', marginBottom: 8 }}>
            {limit.rates.map((r, i) => (
              <div key={i}>
                <strong style={{ color: 'var(--pf-v5-global--Color--100)' }}>
                  {r.limit.toLocaleString()}
                </strong>{' '}
                {t('per')}{' '}
                <code>{r.window}</code>
              </div>
            ))}
          </div>
        )}

        {/* Equivalences — helpful sanity check ("50 rpm ≈ 72k/day, 2.1M/month"). */}
        {!unlimited && (
          <div style={{ fontSize: 12, color: 'var(--pf-v5-global--Color--300)' }}>
            ≈ {compact(dailyEst as number)}/{t('day')} · {compact(monthlyEst as number)}/{t('month')}
          </div>
        )}

        {/* Predicates */}
        {limit.when && limit.when.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--pf-v5-global--Color--300)', marginBottom: 4 }}>
              {t('Applies when')}
            </div>
            <LabelGroup numLabels={3} isCompact>
              {limit.when.map((w, i) => {
                const txt = predicateText(w);
                return (
                  <Tooltip key={i} content={<code>{txt}</code>}>
                    <Label color="teal" isCompact>
                      {txt.length > 40 ? `${txt.slice(0, 37)}…` : txt}
                    </Label>
                  </Tooltip>
                );
              })}
            </LabelGroup>
          </div>
        )}

        {/* Counter keys (when present) */}
        {limit.counters && limit.counters.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--pf-v5-global--Color--300)', marginBottom: 4 }}>
              {t('Counter keys')}
            </div>
            <LabelGroup numLabels={3} isCompact>
              {limit.counters.map((c, i) => (
                <Label key={i} color="grey" isCompact>{counterText(c)}</Label>
              ))}
            </LabelGroup>
          </div>
        )}

        {sourceLabel && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--pf-v5-global--Color--300)' }}>
            {t('From')}:{' '}
            {sourceHref ? <a href={sourceHref}>{sourceLabel}</a> : sourceLabel}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Compact row variant — used inside PolicyAttachmentView so it doesn't blow
// up the height of the attached-policies list. One row per limit; rate +
// predicate inline.
// ---------------------------------------------------------------------------

const LimitRow: React.FC<{ name: string; limit: RateLimit }> = ({ name, limit }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const rpm = ratesToRpm(limit.rates);
  const unlimited = rpm === undefined;
  return (
    <Flex
      spaceItems={{ default: 'spaceItemsSm' }}
      alignItems={{ default: 'alignItemsCenter' }}
      style={{ padding: '6px 0', borderTop: '1px solid var(--pf-v5-global--BorderColor--100)' }}
    >
      <FlexItem style={{ minWidth: 80 }}>
        <Label color={tierLabelColor(name)} isCompact>{name}</Label>
      </FlexItem>
      <FlexItem style={{ minWidth: 120 }}>
        <strong>{unlimited ? '∞' : `${compact(rpm as number)} ${t('req/min')}`}</strong>
      </FlexItem>
      <FlexItem grow={{ default: 'grow' }}>
        {limit.when && limit.when.length > 0 && (
          <LabelGroup numLabels={2} isCompact>
            {limit.when.map((w, i) => {
              const txt = predicateText(w);
              return (
                <Label key={i} color="teal" isCompact>
                  {txt.length > 30 ? `${txt.slice(0, 27)}…` : txt}
                </Label>
              );
            })}
          </LabelGroup>
        )}
      </FlexItem>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const RateLimitVisualizer: React.FC<RateLimitVisualizerProps> = ({
  limits,
  variant = 'cards',
  sourceLabel,
  sourceHref,
  compareAgainstRpm,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const entries = Object.entries(limits || {});

  // Sort heuristically: gold > silver > bronze > others alpha. Without this
  // the cards reflect Go-map iteration order — unstable across refreshes.
  const tierOrder = ['gold', 'silver', 'bronze'];
  const sorted = entries.slice().sort(([a], [b]) => {
    const ai = tierOrder.indexOf(a.toLowerCase());
    const bi = tierOrder.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const maxRpm = compareAgainstRpm ?? sorted.reduce((m, [, lim]) => {
    const rpm = ratesToRpm(lim.rates);
    return rpm !== undefined && rpm > m ? rpm : m;
  }, 0);

  if (sorted.length === 0) {
    return (
      <EmptyState variant="sm" titleText={t('No rate limits configured')} headingLevel="h4">
        <EmptyStateBody>
          {t('This policy does not declare any limits — every request is allowed.')}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  if (variant === 'compact') {
    return (
      <div>
        {sorted.map(([name, limit]) => (
          <LimitRow key={name} name={name} limit={limit} />
        ))}
      </div>
    );
  }

  return (
    <Gallery hasGutter minWidths={{ default: '240px' }}>
      {sorted.map(([name, limit]) => (
        <GalleryItem key={name}>
          <LimitCard
            name={name}
            limit={limit}
            maxRpm={maxRpm}
            sourceLabel={sourceLabel}
            sourceHref={sourceHref}
          />
        </GalleryItem>
      ))}
    </Gallery>
  );
};

export default RateLimitVisualizer;
