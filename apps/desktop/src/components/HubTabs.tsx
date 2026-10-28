import type { KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface HubTab {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconName;
}

/**
 * Tabs de un hub. Mantiene un único tab en el orden de tabulación y permite
 * cambiar con flechas, Home y End sin sacar el foco del tablist.
 */
export function HubTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  readonly tabs: readonly HubTab[];
  readonly active: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel: string;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="tab"]',
    )[next];
    target?.focus();
    onChange(tabs[next]!.id);
  }

  return (
    <div className="hub-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          data-tooltip={tab.hint}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
          className={`hub-tab${active === tab.id ? ' active' : ''}`}
        >
          {tab.icon ? <Icon name={tab.icon} size={14} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
