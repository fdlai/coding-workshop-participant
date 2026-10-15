import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { onUnauthorized, tokenExpiresAt, tokenStore } from '../services/api';
import { authApi } from '../services/endpoints';

const AuthContext = createContext(null);

/** Renew the token this long before it expires, so active users stay signed in. */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Holds the signed-in user for the whole app.
 *
 * The JWT lives in localStorage so a refresh keeps the session. Tradeoff:
 * localStorage is readable by any script on the page (XSS); we never log the
 * token and the backend enforces permissions on every request regardless.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Restore the session on first load, and log out whenever the API says 401.
  useEffect(() => {
    onUnauthorized(logout);
    if (!tokenStore.get()) return;
    authApi
      .me()
      .then(setUser)
      .catch(logout)
      .finally(() => setLoading(false));
  }, [logout]);

  // Silent refresh: shortly before the token expires, swap it for a new one. The server
  // caps the whole session (MAX_SESSION_DAYS); when it refuses, its 401 signs the user out.
  // A network failure is ignored: the old token keeps working until it actually expires.
  const [tokenVersion, setTokenVersion] = useState(0);
  useEffect(() => {
    if (!user) return undefined;
    const expiresAt = tokenExpiresAt(tokenStore.get());
    if (!expiresAt) return undefined;
    const delay = Math.max(0, expiresAt - REFRESH_BEFORE_EXPIRY_MS - Date.now());
    const timer = setTimeout(() => {
      authApi
        .refresh()
        .then(({ access_token: token }) => {
          tokenStore.set(token);
          setTokenVersion((version) => version + 1);
        })
        .catch(() => {});
    }, delay);
    return () => clearTimeout(timer);
  }, [user, tokenVersion]);

  const login = useCallback(async (username, password) => {
    const { access_token: token } = await authApi.login(username, password);
    tokenStore.set(token);
    const me = await authApi.me();
    setUser(me);
    setTokenVersion((version) => version + 1);
    return me;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, setUser }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = { children: PropTypes.node.isRequired };

/** Access the current user and login/logout actions. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
