import React from 'react';
import { createPortal } from 'react-dom';
import '../domain-settings/settings-navigation.css';

export default function MobileFooter({ items, label, contentSelector, className = '' }) {
  return createPortal(<div className={`settings-mobile-footer ${className}`}>
    <nav className="settings-bottom-navigation" aria-label={label}>
      {items.map(({ element, label: itemLabel, icon, current, ariaCurrent = 'page' }) => React.cloneElement(element, {
        key: element.key || itemLabel,
        className: current ? 'settings-bottom-item is-current' : 'settings-bottom-item',
        'aria-label': itemLabel,
        title: element.props.title || itemLabel,
        'aria-current': current ? ariaCurrent : undefined,
        onClick: event => {
          if (element.props.disabled || element.props['aria-disabled'] === true || element.props['aria-disabled'] === 'true') { event.preventDefault(); return; }
          element.props.onClick?.(event);
          const newContext = element.props.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
          if (!event.defaultPrevented && !newContext) {
            document.querySelector(contentSelector)?.scrollTo?.({ top: 0, behavior: 'auto' });
            window.scrollTo({ top: 0, behavior: 'auto' });
          }
        },
        children: <>{icon}<span className="settings-bottom-label">{itemLabel}</span></>,
      }))}
    </nav>
  </div>, document.body);
}
