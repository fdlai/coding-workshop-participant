import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { onUnauthorized, tokenStore } from '../services/api';
import { authApi } from '../services/endpoints';

const AuthContext = createContext(null);

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

  const login = useCallback(async (username, password) => {
    const { access_token: token } = await authApi.login(username, password);
    tokenStore.set(token);
    const me = await authApi.me();
    setUser(me);
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
