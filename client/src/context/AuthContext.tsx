import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setStoredToken, getStoredToken } from '../api/client';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { displayName?: string; avatarUrl?: string; preferences?: Partial<User['preferences']> }) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchCurrentUser = async () => {
    try {
      const res = await api.getMe();
      if (res && res.user) {
        setUser(res.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if redirected from Google OAuth with token
    const urlParams = new URLSearchParams(window.location.search);
    const oauthToken = urlParams.get('token');
    const authSuccess = urlParams.get('auth_success');

    if (oauthToken && authSuccess === '1') {
      setStoredToken(oauthToken);
      // Clean query params from URL without reload
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }

    const demoParam = urlParams.get('demo');
    if (demoParam === '1' && !getStoredToken()) {
      loginDemo();
      return;
    }

    fetchCurrentUser();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await api.login(email, password);
      if (res.token) {
        setStoredToken(res.token);
      }
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string, displayName: string) => {
    try {
      const res = await api.register(email, password, displayName);
      if (res.token) {
        setStoredToken(res.token);
      }
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const loginDemo = async () => {
    try {
      const res = await api.loginDemo();
      if (res.token) {
        setStoredToken(res.token);
      }
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors on logout
    } finally {
      setStoredToken(null);
      setUser(null);
    }
  };

  const updateProfile = async (data: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: Partial<User['preferences']>;
  }) => {
    const res = await api.updateProfile(data);
    if (res.user) {
      setUser(res.user);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        loginDemo,
        logout,
        updateProfile,
        refreshUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
