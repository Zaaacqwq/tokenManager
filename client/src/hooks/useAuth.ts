import { useState, useCallback } from 'react';

interface AuthState {
  token: string | null;
  username: string | null;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: localStorage.getItem('token'),
    username: localStorage.getItem('username'),
  }));

  const login = useCallback((token: string, username: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
    setAuth({ token, username });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setAuth({ token: null, username: null });
  }, []);

  return {
    isAuthenticated: !!auth.token,
    username: auth.username,
    login,
    logout,
  };
}
