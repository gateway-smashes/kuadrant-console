import * as React from 'react';
import {
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { useAvailableNamespaces } from '../../hooks/useAvailableNamespaces';

const ALL_KEY = '__all__';

interface Props {
  namespace: string | null;
  onChange: (ns: string | null) => void;
}

/**
 * Compact namespace picker for the Overview header. Lists only the
 * namespaces that hold at least one RHCL resource (Gateway / HTTPRoute /
 * APIProduct / any Policy) — see useAvailableNamespaces. On a
 * production cluster with 40+ projects, that trims the list to the two
 * or three the operator actually cares about.
 *
 * The "All namespaces" option (value `null`) is the default and lives
 * at the top of the list; a divider isn't necessary since the visual
 * italic on that option carries the semantic weight.
 */
const OverviewNamespaceFilter: React.FC<Props> = ({ namespace, onChange }) => {
  const { t } = useTranslation('plugin__kuadrant-console');
  const { namespaces, loaded } = useAvailableNamespaces();
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedLabel = namespace ?? t('All namespaces');

  return (
    <Select
      aria-label={t('Filter Overview by namespace')}
      isOpen={isOpen}
      selected={namespace ?? ALL_KEY}
      onOpenChange={(o) => setIsOpen(o)}
      onSelect={(_e, value) => {
        setIsOpen(false);
        if (value === ALL_KEY || value == null) {
          onChange(null);
        } else {
          onChange(String(value));
        }
      }}
      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          onClick={() => setIsOpen((o) => !o)}
          isExpanded={isOpen}
          isDisabled={!loaded && namespaces.length === 0}
          style={{ minWidth: 200 }}
        >
          {/* Prefix helps set expectation this is a scope, not a project
              picker for the whole console. */}
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', marginRight: 6 }}>
            {t('Namespace:')}
          </span>
          {selectedLabel}
        </MenuToggle>
      )}
      shouldFocusToggleOnSelect
    >
      <SelectList>
        <SelectOption value={ALL_KEY}>
          <span style={{ fontStyle: 'italic' }}>{t('All namespaces')}</span>
        </SelectOption>
        {namespaces.map((ns) => (
          <SelectOption key={ns} value={ns}>
            {ns}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
};

export default OverviewNamespaceFilter;
