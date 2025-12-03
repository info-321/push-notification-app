import { useEffect, useState } from 'react';
import './App.css';
import Login from './components/login/Login';
import Splash from './components/splash/Splash';
import Domain from './components/domain-settings/Domain';
import Settings from './components/domain-settings/Settings';
import SiteSelect from './components/site-select-list/SiteSelect';
import Configuration from './components/domain-settings/Configuration';

const App = () => {
  // Restore persisted auth/view state so reloads stay on the same page.
  const initialAuth = localStorage.getItem('auth') === 'true';
  const initialView = initialAuth ? localStorage.getItem('view') || 'domain' : 'login';
  const initialSplash = initialAuth ? Number(localStorage.getItem('remainingSplash') || 0) : 1;
  const initialDomainSetup = localStorage.getItem('domainSetupComplete') === 'true';
  const initialDomainKey = localStorage.getItem('selectedDomainKey') || '';
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

  // Apply page-specific body backgrounds.
  useEffect(() => {
    const classes = ['login-bg', 'splash-bg', 'domain-bg'];
    document.body.classList.remove(...classes);
    if (view === 'login') {
      document.body.classList.add('login-bg');
    } else if (view === 'splash') {
      document.body.classList.add('splash-bg');
    } else if (view === 'domain' || view === 'settings' || view === 'sites') {
      document.body.classList.add('domain-bg');
    }
  }, [view]);

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
    localStorage.removeItem('auth');
    localStorage.removeItem('view');
    localStorage.removeItem('selectedDomainKey');
    localStorage.removeItem('selectedDomainName');
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

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (view === 'splash' && remainingSplashViews > 0) {
    return <Splash onDone={handleSplashDone} />;
  }

  if (view === 'settings') {
    return <Settings onBack={() => setView('domain')} onLogout={handleLogout} />;
  }

  if (view === 'sites') {
    return (
      <SiteSelect
        onAddDomain={() => setView('domain')}
        onSettings={() => setView('settings')}
        onLogout={handleLogout}
        onSelectDomain={(key, name) => {
          setSelectedDomainKey(key);
          setSelectedDomainName(name);
          setView('config');
          // Update URL to mimic /settings/config?domain=<key>
          window.history.pushState({}, '', `/settings/config?domain=${encodeURIComponent(key)}`);
        }}
      />
    );
  }

  if (view === 'config') {
    return (
      <Configuration
        domainKey={selectedDomainKey}
        domainName={selectedDomainName}
        onLogout={handleLogout}
        onSettings={() => setView('settings')}
        onBackToSites={() => setView('sites')}
      />
    );
  }

  // Default post-login destination is Domain page.
  return (
    <Domain
      onLogout={handleLogout}
      onSettings={() => setView('settings')}
    	 onSiteSelect={(domainKey, domainName) => {
        // When domain is successfully saved, mark setup complete and show SiteSelect by default.
        setDomainSetupComplete(true);
        if (domainKey) {
          setSelectedDomainKey(domainKey);
          setSelectedDomainName(domainName || '');
          setView('config');
          window.history.pushState({}, '', `/settings/config?domain=${encodeURIComponent(domainKey)}`);
        } else {
          setView('sites');
        }
      }}
      onConfigTab={() => {
        if (selectedDomainKey) {
          setView('config');
          window.history.pushState({}, '', `/settings/config?domain=${encodeURIComponent(selectedDomainKey)}`);
        }
      }}
    />
  );
};

export default App;
