export const API_BASE = (process.env.REACT_APP_API_BASE || 'http://localhost:5000').replace(/\/$/, '');

export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem('sessionToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers }).then(response => {
    if (response.status === 401) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('auth');
      window.dispatchEvent(new Event('auth-expired'));
    }
    return response;
  });
}
