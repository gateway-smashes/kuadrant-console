import * as React from 'react';
import { Grid, GridItem } from '@patternfly/react-core';
import {
  NetworkIcon,
  RouteIcon,
  SecurityIcon,
  ServerIcon,
  CubesIcon,
} from '@patternfly/react-icons';
import EnvironmentHealthCard from './EnvironmentHealthCard';
import { EnvironmentHealthCardData } from './types';

interface Props {
  cards: EnvironmentHealthCardData[];
}

// Map card id → icon. Keeps the card itself generic; icon assignment is a
// pure UI concern that lives next to the section that arranges them.
const ICONS: Record<string, React.ReactNode> = {
  gateways: <NetworkIcon color="var(--pf-t--global--color--status--info--default)" />,
  httproutes: <RouteIcon color="var(--pf-t--global--color--status--info--default)" />,
  policies: <SecurityIcon color="var(--pf-t--global--color--status--success--default)" />,
  backends: <ServerIcon color="var(--pf-t--global--color--status--warning--default)" />,
  'api-products': <CubesIcon color="var(--pf-t--global--color--status--info--default)" />,
};

/**
 * Row of 5 KPI cards. Stays 5-wide on xl, wraps on smaller breakpoints.
 */
export const EnvironmentHealthSection: React.FC<Props> = ({ cards }) => {
  return (
    <Grid hasGutter>
      {cards.map((c) => (
        <GridItem key={c.id} xl={Math.floor(12 / Math.max(cards.length, 1)) as 2 | 3 | 4 | 6} lg={4} md={6} sm={12}>
          <EnvironmentHealthCard data={c} iconSlot={ICONS[c.id]} />
        </GridItem>
      ))}
    </Grid>
  );
};

export default EnvironmentHealthSection;
