import { useCallback, useEffect, useState } from 'react';
import './App.css';
import Login from './components/login/Login';
import Splash from './components/splash/Splash';
import Domain from './components/domain-settings/Domain';
import Settings from './components/domain-settings/Settings';
import SiteSelect from './components/site-select-list/SiteSelect';
import Dashboard from './components/dashboard/Dashboard';
import DomainList from './components/domain-settings/DomainList';
// Note: Configuration content now lives inside Domain tabs; no separate view.

const App = () => {
  // Restore persisted auth/view state so reloads stay on the same page.
  const initialAuth = localStorage.getItem('auth') === 'true' && Boolean(localStorage.getItem('sessionToken'));
  const params = new URLSearchParams(window.location.search);
  const routeKey = params.get('domain') || '';
  const routeView = window.location.pathname === '/settings/domains' ? 'domains'
    : window.location.pathname === '/dashboard' ? (routeKey ? 'overview' : 'sites')
    : window.location.pathname.startsWith('/settings/') ? 'domain' : null;
  const initialView = initialAuth ? routeView || localStorage.getItem('view') || 'domain' : 'login';
  const initialSplash = initialAuth ? Number(localStorage.getItem('remainingSplash') || 0) : 1;
  const initialDomainSetup = localStorage.getItem('domainSetupComplete') === 'true';
  const initialDomainKey = routeKey || localStorage.getItem('selectedDomainKey') || '';
  const initialDomainName = localStorage.getItem('selectedDomainName') || '';

  const [isAuthenticated, setIsAuthenticated] = useState(initialAuth);
  // Splash count (persisted). Keep at 1 so it only shows on first login unless changed.
  const [remainingSplashViews, setRemainingSplashViews] = useState(initialSplash);
  // Which view to show: login, splash, domain, settings, site-select.
  const [view, setView] = useState(initialView);
  // Whether user already completed domain setup; if true, skip Domain on future logins.
  const [domainSetupComplete, setDomainSetupComplete] = useState(initialDomainSetup);
  // Current domain selection (for config routing)
  const [selectedDomainKey, setSelectedDomainKey] = useState(initialDomainKey);
  const [selectedDomainName, setSelectedDomainName] = useState(initialDomainName);
  // Which tab should Domain open on (domain/config). Defaults to domain.
  const [domainTab, setDomainTab] = useState(window.location.pathname === '/settings/config' ? 'config' : 'domain');

  useEffect(() => {
    const expire = () => { setIsAuthenticated(false); setView('login'); };
    window.addEventListener('auth-expired', expire);
    return () => window.removeEventListener('auth-expired', expire);
  }, []);

  // Helper to sync view/tab from the current URL (supports /dashboard, /settings/domain, /settings/config?domain=KEY).
  const syncViewFromUrl = useCallback(() => {
    if (!isAuthenticated) return;
    const path = window.location.pathname;
    if (path === '/dashboard') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView(key ? 'overview' : 'sites');
      setDomainTab('domain');
    } else if (path === '/settings/domains') {
      setView('domains');
    } else if (path === '/settings/domain') {
      setView('domain');
      setDomainTab('domain');
    } else if (path.startsWith('/settings/config')) {
      const params = new URLSearchParams(window.location.search);
      const key = params.get('domain') || '';
      if (key) {
        setSelectedDomainKey(key);
        setDomainTab('config');
      }
      setView('domain');
    }
  }, [isAuthenticated]);

  // On first load and whenever auth toggles on, honor direct URLs.
  useEffect(() => {
    syncViewFromUrl();
  }, [syncViewFromUrl]);

  // Listen for manual URL changes (back/forward or typing new path) to resync view.
  useEffect(() => {
    const handler = () => syncViewFromUrl();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [syncViewFromUrl]);

  // Apply page-specific body backgrounds.
  useEffect(() => {
    const classes = ['login-bg', 'splash-bg', 'domain-bg'];
    document.body.classList.remove(...classes);
    if (view === 'login') {
      // Keep URL consistent when on the login screen.
      window.history.pushState({}, '', '/login');
      document.body.classList.add('login-bg');
    } else if (view === 'splash') {
      document.body.classList.add('splash-bg');
    } else if (view === 'domain' || view === 'settings' || view === 'sites' || view === 'overview' || view === 'domains') {
      document.body.classList.add('domain-bg');
      if (view === 'sites' || view === 'overview') {
        const url = view === 'overview' && selectedDomainKey ? `/dashboard?domain=${encodeURIComponent(selectedDomainKey)}` : '/dashboard';
        if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
      }
      if (view === 'domains' && window.location.pathname !== '/settings/domains') window.history.pushState({}, '', '/settings/domains');
    }
  }, [view, selectedDomainKey]);

  // Persist auth/view/splash counters so refreshes keep the current page.
  useEffect(() => {
    localStorage.setItem('auth', isAuthenticated ? 'true' : 'false');
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem('view', view);
    }
  }, [view, isAuthenticated]);

  useEffect(() => {
    localStorage.setItem('remainingSplash', String(remainingSplashViews));
  }, [remainingSplashViews]);

  useEffect(() => {
    localStorage.setItem('domainSetupComplete', domainSetupComplete ? 'true' : 'false');
  }, [domainSetupComplete]);

  useEffect(() => {
    if (selectedDomainKey) localStorage.setItem('selectedDomainKey', selectedDomainKey);
    if (selectedDomainName) localStorage.setItem('selectedDomainName', selectedDomainName);
  }, [selectedDomainKey, selectedDomainName]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setView('login');
    // Also push the login URL on logout for consistency.
    window.history.pushState({}, '', '/login');
    localStorage.removeItem('auth');
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('view');
    localStorage.removeItem('selectedDomainKey');
    localStorage.removeItem('selectedDomainName');
    setDomainTab('domain');
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    // If domain setup is done, jump straight to site selection on future logins.
    if (domainSetupComplete) {
      setView('sites');
      return;
    }
    // Otherwise, show splash once, then domain setup.
    if (remainingSplashViews > 0) {
      setView('splash');
    } else {
      setView('domain');
    }
  };

  const handleSplashDone = () => {
    // Force exit the splash carousel and navigate to Domain.jsx.
    setRemainingSplashViews(0);
    setView('domain');
  };

  const openOverview = (key, name) => {
    setSelectedDomainKey(key);
    setSelectedDomainName(name || '');
    setView('overview');
  };

  const openConfiguration = (key, name, send = false) => {
    setSelectedDomainKey(key);
    setSelectedDomainName(name || '');
    setDomainTab('config');
    window.history.pushState({}, '', `/settings/config?domain=${encodeURIComponent(key)}${send ? '#send-push' : ''}`);
    setView('domain');
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (view === 'splash' && remainingSplashViews > 0) {
    return <Splash onDone={handleSplashDone} />;
  }

  if (view === 'settings') {
    return <Settings onBack={() => setView('domains')} onLogout={handleLogout} />;
  }

  if (view === 'domains') {
    return <DomainList
      selectedDomainKey={selectedDomainKey}
      onNew={() => { setDomainTab('domain'); setView('domain'); }}
      onConfiguration={openConfiguration}
      onDashboard={(key, name) => key ? openOverview(key, name) : setView('sites')}
      onSettings={() => setView('settings')}
      onLogout={handleLogout}
      onDeleted={keys => {
        if (keys.includes(selectedDomainKey)) {
          setSelectedDomainKey(''); setSelectedDomainName('');
          localStorage.removeItem('selectedDomainKey'); localStorage.removeItem('selectedDomainName');
        }
      }}
    />;
  }

  if (view === 'overview' && selectedDomainKey) {
    return <Dashboard
      domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')}
      onManageDomains={() => setView('domains')}
      onSelectDomain={openOverview}
      onConfiguration={openConfiguration}
      onSendPush={(key, name) => openConfiguration(key, name, true)}
      onLogout={handleLogout}
    />;
  }

  if (view === 'sites') {
    return (
      <SiteSelect
        onAddDomain={() => {
          setDomainTab('domain');
          setView('domain');
        }}
        onSettings={() => setView('settings')}
        onManageDomains={() => setView('domains')}
        onLogout={handleLogout}
        onSelectDomain={openOverview}
        onEditDomain={item => openConfiguration(item.key, item.name)}
      />
    );
  }

  // Default post-login destination is Domain page.
  return (
    <Domain
      onDomains={() => setView('domains')}
      onDashboard={() => selectedDomainKey ? openOverview(selectedDomainKey, selectedDomainName) : setView('sites')}
      onLogout={handleLogout}
      onSettings={() => setView('settings')}
      selectedDomainKey={selectedDomainKey}
      selectedDomainName={selectedDomainName}
      defaultTab={domainTab}
      onSiteSelect={(domainKey, domainName) => {
        // When domain is successfully saved, mark setup complete and show SiteSelect by default.
        setDomainSetupComplete(true);
        if (domainKey) {
          setSelectedDomainKey(domainKey);
          setSelectedDomainName(domainName || '');
          setDomainTab('config');
          setView('domain');
        } else {
          setDomainTab('domain');
          setView('sites');
        }
      }}
      onSelectDomainTab={setDomainTab}
    />
  );
};

export default App;
