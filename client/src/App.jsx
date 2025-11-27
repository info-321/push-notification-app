import { useEffect, useState } from 'react';
import './App.css';
import Login from './components/login/Login';
import Splash from './components/splash/Splash';
import Domain from './components/domain-settings/Domain';

const App = () => {
  // Track if user is logged in.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // For testing: show the splash carousel 5 times after login.
  const [remainingSplashViews, setRemainingSplashViews] = useState(5);
  // Which view to show: login, splash, domain.
  const [view, setView] = useState('login');

  // Apply page-specific body backgrounds.
  useEffect(() => {
    const classes = ['login-bg', 'splash-bg', 'domain-bg'];
    document.body.classList.remove(...classes);
    if (view === 'login') {
      document.body.classList.add('login-bg');
    } else if (view === 'splash') {
      document.body.classList.add('splash-bg');
    } else if (view === 'domain') {
      document.body.classList.add('domain-bg');
    }
  }, [view]);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    // After login, show splash while we still have views remaining.
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

  // Default post-login destination is Domain page.
  return <Domain />;
};

export default App;
