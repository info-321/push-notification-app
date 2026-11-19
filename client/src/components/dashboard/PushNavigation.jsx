import React, { useContext } from 'react';
import { SettingsAccessContext, useMobileSettings } from '../domain-settings/SettingsNavigation';
import './push-navigation.css';

export default function PushNavigation({ children, onNavigate = href => window.location.assign(href) }) {
  const mobile = useMobileSettings(), profile = useContext(SettingsAccessContext);
  if (!mobile) return <nav className="analytics-navigation" aria-label="Push navigation">{children}</nav>;
  const items = React.Children.toArray(children).filter(item => React.isValidElement(item) &&
    (profile?.role !== 'viewer' || ['Reports', 'Analytics'].includes(item.props.children)));
  const current = items.findIndex(item => item.props['aria-current'] === 'page');
  return <nav className="push-mobile-navigation" aria-label="Push navigation">
    <label><span>Push Notification</span><select aria-label="Push section" value={current < 0 ? '' : String(current)} onChange={event => {
      const item = items[Number(event.target.value)];
      if (!item || item.props.disabled || item.props['aria-current'] === 'page') return;
      if (item.props.href) onNavigate(item.props.href);
      else item.props.onClick?.(event);
    }}>
      {current < 0 && <option value="" disabled>Choose a section</option>}
      {items.map((item, index) => <option key={item.key || index} value={String(index)} disabled={item.props.disabled}>{item.props.children}{item.props.disabled ? ' (coming soon)' : ''}</option>)}
    </select></label>
  </nav>;
}
