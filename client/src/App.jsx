import { useCallback, useEffect, useState } from 'react';
import './App.css';
import {API_BASE,apiFetch,browserSession,authEpoch,authChanged} from './api';
import {saveLoginReturn,readLoginReturn,clearLoginReturn,permittedLoginDestination} from './login-routing';
import UserManagement from './components/domain-settings/UserManagement';
import Login from './components/login/Login';
import Splash from './components/splash/Splash';
import Domain from './components/domain-settings/Domain';
import Settings from './components/domain-settings/Settings';
import SiteSelect from './components/site-select-list/SiteSelect';
import Dashboard from './components/dashboard/Dashboard';
import Analytics from './components/dashboard/Analytics';
import PushComposer from './components/dashboard/PushComposer';
import PromptSettings from './components/dashboard/PromptSettings';
import ScheduleList from './components/dashboard/ScheduleList';
import Reports from './components/dashboard/Reports';
import DomainList from './components/domain-settings/DomainList';
import Account from './components/domain-settings/Account';
import PwaSettings from './components/domain-settings/PwaSettings';
// Note: Configuration content now lives inside Domain tabs; no separate view.

const Workspace = ({onLogoutError}) => {
  // Restore persisted auth/view state so reloads stay on the same page.
  const initialAuth = false; // The server cookie is the authority; localStorage never authenticates.
  const recoveryLink=/^#(?:reset|verify)=/.test(window.location.hash);
  const [booting,setBooting]=useState(!recoveryLink);
  const [bootError,setBootError]=useState('');
  const params = new URLSearchParams(window.location.search);
  const routeKey = params.get('domain') || '';
  const routeView = window.location.pathname === '/push/reports' ? 'reports' : window.location.pathname === '/push/schedules' ? 'schedules' : window.location.pathname === '/push/settings' ? 'prompt-settings' : window.location.pathname === '/push' ? 'push' : window.location.pathname === '/analytics' ? 'analytics'
    : window.location.pathname === '/settings/pwa' ? 'pwa'
    : window.location.pathname === '/settings/users' ? 'users' : window.location.pathname === '/settings/account' ? 'account'
    : ['/settings', '/settings/general'].includes(window.location.pathname) ? 'settings'
    : window.location.pathname === '/settings/domains' ? 'domains'
    : window.location.pathname === '/dashboard' ? (routeKey ? 'overview' : 'sites')
    : window.location.pathname.startsWith('/settings/') ? 'domain' : null;
  const initialView = initialAuth ? routeView || localStorage.getItem('view') || 'domain' : 'login';
  const initialSplash = initialAuth ? Number(localStorage.getItem('remainingSplash') || 0) : 1;
  const initialDomainSetup = localStorage.getItem('domainSetupComplete') === 'true';
  const initialDomainKey = routeKey || localStorage.getItem('selectedDomainKey') || '';
  const initialDomainName = localStorage.getItem('selectedDomainName') || '';

  const [isAuthenticated, setIsAuthenticated] = useState(initialAuth);
  const [returnPath,setReturnPath]=useState(()=>!initialAuth ? saveLoginReturn(window.location.pathname+window.location.search+window.location.hash)||readLoginReturn() : null);
  const [loginNotice,setLoginNotice]=useState('');
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
    const expire = () => {
      const next=saveLoginReturn(window.location.pathname+window.location.search+window.location.hash)||readLoginReturn();
      setReturnPath(next);setLoginNotice('Your session has ended. Sign in again to continue.');
      setIsAuthenticated(false);setView('login');
    };
    window.addEventListener('auth-expired', expire);
    return () => window.removeEventListener('auth-expired', expire);
  }, []);

  // Helper to sync view/tab from the current URL (supports /dashboard, /settings/domain, /settings/config?domain=KEY).
  const syncViewFromUrl = useCallback(() => {
    if (!isAuthenticated) return;
    const path = window.location.pathname;
    if (path === '/push/reports' || path === '/push/schedules' || path === '/push' || path === '/analytics' || path === '/push/settings') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView(path === '/push/reports' ? 'reports' : path === '/push/schedules' ? 'schedules' : path === '/push/settings' ? 'prompt-settings' : path === '/push' ? 'push' : 'analytics');
    } else if (path === '/dashboard') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView(key ? 'overview' : 'sites');
      setDomainTab('domain');
    } else if (path === '/settings/pwa') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView('pwa');
    } else if(path === '/settings/users') {
      setView('users');
    } else if (path === '/settings/account') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView('account');
    } else if (path === '/settings' || path === '/settings/general') {
      const key = new URLSearchParams(window.location.search).get('domain');
      if (key) setSelectedDomainKey(key);
      setView('settings');
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
    const handler = () => {
      if(!isAuthenticated&&/^#(?:reset|verify)=/.test(window.location.hash))return; // Let Login consume recovery fragments before URL normalization.
      if(isAuthenticated)syncViewFromUrl();
      else {
        const next=saveLoginReturn(window.location.pathname+window.location.search+window.location.hash);
        if(next)setReturnPath(next);
        window.history.replaceState({},'','/login');
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [syncViewFromUrl,isAuthenticated]);

  useEffect(() => {
    if(!isAuthenticated)return;
    const heartbeat=()=>{if(document.visibilityState==='visible')apiFetch(`${API_BASE}/api/account/heartbeat`,{method:'POST'}).catch(()=>{});};
    const interval=setInterval(heartbeat,60000);
    document.addEventListener('visibilitychange',heartbeat);
    const changed=event=>{if(event.key==='notizo.authChange'){if(localStorage.getItem('auth')!=='true'){setReturnPath(saveLoginReturn(window.location.pathname+window.location.search+window.location.hash));setLoginNotice('Your session ended in another tab. Sign in again to continue.');setIsAuthenticated(false);setView('login');}else window.location.reload();}};
    window.addEventListener('storage',changed);
    return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',heartbeat);window.removeEventListener('storage',changed);};
  },[isAuthenticated]);

  // Apply page-specific body backgrounds.
  useEffect(() => {
    const classes = ['login-bg', 'splash-bg', 'domain-bg'];
    document.body.classList.remove(...classes);
    if (view === 'login') {
      // Keep URL consistent when on the login screen.
      window.history.replaceState({}, '', '/login');
      document.body.classList.add('login-bg');
    } else if (view === 'splash') {
      document.body.classList.add('splash-bg');
    } else if (view === 'reports' || view === 'schedules' || view === 'prompt-settings' || view === 'push' || view === 'analytics' || view === 'pwa' || view === 'domain' || view === 'settings' || view === 'account' || view === 'users' || view === 'sites' || view === 'overview' || view === 'domains') {
      document.body.classList.add('domain-bg');
      if (view === 'push' || view === 'analytics' || view === 'prompt-settings' || view === 'schedules' || view === 'reports') {
        const url = `/${view === 'reports' ? 'push/reports' : view === 'schedules' ? 'push/schedules' : view === 'prompt-settings' ? 'push/settings' : view === 'push' ? 'push' : 'analytics'}${selectedDomainKey ? `?domain=${encodeURIComponent(selectedDomainKey)}` : ''}`;
        const currentParams = new URLSearchParams(window.location.search);
        const copyId = view === 'push' && currentParams.get('domain') === selectedDomainKey ? currentParams.get('copy') : '';
        const target = copyId ? url + '&copy=' + encodeURIComponent(copyId) : url;
        if (window.location.pathname + window.location.search !== target) window.history.pushState({}, '', target);
      }
      if (view === 'sites' || view === 'overview') {
        const url = view === 'overview' && selectedDomainKey ? `/dashboard?domain=${encodeURIComponent(selectedDomainKey)}` : '/dashboard';
        if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
      }
      if(view === 'users' && window.location.pathname !== '/settings/users') window.history.pushState({},'', '/settings/users');
      if (view === 'domains' && window.location.pathname !== '/settings/domains') window.history.pushState({}, '', '/settings/domains');
      if (view === 'settings' || view === 'account' || view === 'pwa') {
        const url = `/settings${view === 'account' ? '/account' : view === 'pwa' ? '/pwa' : ''}${selectedDomainKey ? `?domain=${encodeURIComponent(selectedDomainKey)}` : ''}`;
        if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
      }
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

  const handleLogout = async () => {
    onLogoutError('');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try {const response=await apiFetch(`${API_BASE}/api/logout`,{method:'POST',signal:controller.signal});if(!response.ok&&response.status!==401)throw new Error();}
    catch{onLogoutError('Could not complete sign-out. Check your connection and try Log out again.');return;}
    finally{clearTimeout(timeout);}
    clearLoginReturn();setReturnPath(null);setLoginNotice('You have signed out.');
    setSelectedDomainKey(''); setSelectedDomainName('');
    setIsAuthenticated(false);
    setView('login');
    // Also push the login URL on logout for consistency.
    window.history.replaceState({}, '', '/login');
    localStorage.removeItem('auth');
    authChanged();
    localStorage.removeItem('view');
    localStorage.removeItem('selectedDomainKey');
    localStorage.removeItem('selectedDomainName');
    setDomainTab('domain');
  };

  const handleLoginSuccess = async ({signal}={}) => {
    const epoch=authEpoch();
    let profile=null,domains=[],target=null,rejected=false;
    try {
      const responses=await Promise.all([apiFetch(`${API_BASE}/api/account`,{signal}),apiFetch(`${API_BASE}/api/domains`,{signal})]);
      rejected=responses.some(response=>response.status===401);
      const results=await Promise.all(responses.map(response=>response.json()));
      if(responses[0].ok&&results[0].ok)profile=results[0].data;
      if(responses[1].ok&&results[1].ok&&Array.isArray(results[1].data))domains=results[1].data;
      target=permittedLoginDestination(returnPath||readLoginReturn(),profile,domains);
    }catch{/* A failed permission lookup falls back to website selection, never the requested restricted page. */}
    if(rejected||signal?.aborted||authEpoch()!==epoch)throw Object.assign(new Error('Your session could not be verified. Please sign in again.'),{handled:true});
    const hadReturn=Boolean(returnPath||readLoginReturn());
    clearLoginReturn();setReturnPath(null);setLoginNotice('');
    setSelectedDomainKey('');setSelectedDomainName('');
    localStorage.removeItem('selectedDomainKey');localStorage.removeItem('selectedDomainName');
    setIsAuthenticated(true);
    if(target){
      const url=new URL(target,window.location.origin),key=url.searchParams.get('domain')||'';
      setSelectedDomainKey(key);setSelectedDomainName(domains.find(site=>site.domain_key===key)?.domain_name||'');
      setDomainTab(url.pathname==='/settings/config'?'config':'domain');
      const destinations={'/push':'push','/push/reports':'reports','/push/schedules':'schedules','/push/settings':'prompt-settings','/analytics':'analytics','/settings':'settings','/settings/general':'settings','/settings/account':'account','/settings/users':'users','/settings/domains':'domains','/settings/pwa':'pwa','/settings/config':'domain','/settings/domain':'domain'};
      window.history.replaceState({},'',target);
      setView(url.pathname==='/dashboard'?(key?'overview':'sites'):destinations[url.pathname]);
      if(domains.length)setDomainSetupComplete(true);
      return;
    }
    if(hadReturn||domains.length||domainSetupComplete||profile?.role!=='admin'){
      window.history.replaceState({},'','/dashboard');setView('sites');
      if(domains.length)setDomainSetupComplete(true);
    }else if(remainingSplashViews>0)setView('splash');
    else{window.history.replaceState({},'','/settings/domain');setView('domain');}
  };

  useEffect(()=>{
    if(recoveryLink)return;
    const controller=new AbortController();let disposed=false,timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    browserSession({signal:controller.signal}).then(async data=>{if(data.authenticated)await handleLoginSuccess({signal:controller.signal});}).catch(error=>{if(!disposed)setBootError(timedOut?'Session check timed out. Check your connection and try again.':error.message);}).finally(()=>{clearTimeout(timeout);if(!disposed)setBooting(false);});
    return()=>{disposed=true;clearTimeout(timeout);controller.abort();};
    // Restore once on mount; subsequent sign-ins use the current route state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

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

  const openComposer = (key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name || ''); setView('push'); };

  const openConfiguration = (key, name, send = false) => {
    setSelectedDomainKey(key);
    setSelectedDomainName(name || '');
    setDomainTab('config');
    window.history.pushState({}, '', `/settings/config?domain=${encodeURIComponent(key)}${send ? '#send-push' : ''}`);
    setView('domain');
  };

  if(booting||bootError)return <main className="login-page"><section className="login-help"><h1>Notizo</h1>{bootError?<><p role="alert">{bootError}</p><button className="login-submit" onClick={()=>window.location.reload()}>Try again</button></>:<p role="status">Checking your session...</p>}</section></main>;

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} notice={loginNotice || (returnPath?'Sign in to continue to your workspace.':'')} />;
  }

  if (view === 'splash' && remainingSplashViews > 0) {
    return <Splash onDone={handleSplashDone} />;
  }

  if(view === 'users') return <UserManagement onDashboard={()=>setView('sites')} onLogout={handleLogout}/>;

  if (view === 'settings') {
    return <Settings
      onPwa={() => setView('pwa')}
      key={selectedDomainKey}
      selectedDomainKey={selectedDomainKey}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name); }}
      onConfiguration={openConfiguration}
      onDashboard={(key, name) => key ? openOverview(key, name) : setView('sites')}
      onBack={() => setView('domains')}
      onAccount={() => setView('account')}
      onLogout={handleLogout}
    />;
  }

  if (view === 'pwa') {
    return <PwaSettings
      key={selectedDomainKey}
      selectedDomainKey={selectedDomainKey}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name); }}
      onSettings={() => setView('settings')}
      onAccount={() => setView('account')}
      onDomains={() => setView('domains')}
      onConfiguration={openConfiguration}
      onDashboard={(key, name) => key ? openOverview(key, name) : setView('sites')}
      onLogout={handleLogout}
    />;
  }

  if (view === 'account') {
    return <Account
      onPwa={() => setView('pwa')}
      selectedDomainKey={selectedDomainKey}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name); }}
      onSettings={() => setView('settings')}
      onDomains={() => setView('domains')}
      onConfiguration={openConfiguration}
      onDashboard={(key, name) => key ? openOverview(key, name) : setView('sites')}
      onLogout={handleLogout}
    />;
  }

  if (view === 'domains') {
    return <DomainList
      onPwa={() => setView('pwa')}
      onAccount={() => setView('account')}
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

  if (view === 'push' && selectedDomainKey) {
    return <PushComposer key={selectedDomainKey} domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')} onManageDomains={() => setView('domains')} onSettings={() => setView('settings')}
      onSelectDomain={openComposer} onDashboard={openOverview} onConfiguration={openConfiguration} onLogout={handleLogout} />;
  }

  if (view === 'reports' && selectedDomainKey) {
    return <Reports key={selectedDomainKey} domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')} onManageDomains={() => setView('domains')} onSettings={() => setView('settings')}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name || ''); }}
      onDashboard={openOverview} onConfiguration={openConfiguration} onLogout={handleLogout} />;
  }

  if (view === 'schedules' && selectedDomainKey) {
    return <ScheduleList key={selectedDomainKey} domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')} onManageDomains={() => setView('domains')} onSettings={() => setView('settings')}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name || ''); }}
      onDashboard={openOverview} onConfiguration={openConfiguration} onLogout={handleLogout} />;
  }

  if (view === 'prompt-settings' && selectedDomainKey) {
    return <PromptSettings key={selectedDomainKey} domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')} onManageDomains={() => setView('domains')} onSettings={() => setView('settings')}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name || ''); }}
      onDashboard={openOverview} onConfiguration={openConfiguration} onLogout={handleLogout} />;
  }

  if (view === 'analytics' && selectedDomainKey) {
    return <Analytics
      key={selectedDomainKey}
      domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')}
      onManageDomains={() => setView('domains')}
      onSettings={() => setView('settings')}
      onSelectDomain={(key, name) => { setSelectedDomainKey(key); setSelectedDomainName(name); }}
      onDashboard={openOverview}
      onConfiguration={openConfiguration}
      onSendPush={openComposer}
      onLogout={handleLogout}
    />;
  }
  if ((view === 'analytics' || view === 'push' || view === 'prompt-settings' || view === 'schedules' || view === 'reports') && !selectedDomainKey) {
    return <SiteSelect onAccount={() => setView('account')} onAddDomain={() => { setDomainTab('domain'); setView('domain'); }} onSettings={() => setView('settings')} onManageDomains={() => setView('domains')} onLogout={handleLogout} onSelectDomain={openOverview} />;
  }

  if (view === 'overview' && selectedDomainKey) {
    return <Dashboard
      domainKey={selectedDomainKey}
      onAllSites={() => setView('sites')}
      onManageDomains={() => setView('domains')}
      onSettings={() => setView('settings')}
      onSelectDomain={openOverview}
      onConfiguration={openConfiguration}
      onSendPush={openComposer}
      onLogout={handleLogout}
    />;
  }

  if (view === 'sites') {
    return (
      <SiteSelect
        onAccount={() => setView('account')}
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
      onPwa={() => setView('pwa')}
      onAccount={() => setView('account')}
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

export default function App(){
  const [logoutError,setLogoutError]=useState('');
  return <><Workspace onLogoutError={setLogoutError}/>{logoutError&&<div className="logout-error" role="alert"><span>{logoutError}</span><button type="button" aria-label="Dismiss sign-out message" onClick={()=>setLogoutError('')}>Dismiss</button></div>}</>;
}
