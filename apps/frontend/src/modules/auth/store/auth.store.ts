'use client';

import { create } from 'zustand';
import type { AuthUser, AuthSession } from '../types/auth.types';

interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  setSession: (session: AuthSession | null) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
}

// Sync-read from localStorage so the very first render skips the spinner when
// the user is already cached (optimistic hydration). AuthProvider still validates
// the session against the backend asynchronously and clears on expiry.
const readCachedUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('bluebee_user');
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'id' in parsed) return parsed as AuthUser;
    return null;
  } catch {
    return null;
  }
};

const cachedUser = readCachedUser();

export const useAuthStore = create<AuthState>((set) => ({
  session: cachedUser ? { user: cachedUser } : null,
  isLoading: cachedUser === null, // false if session is already cached → no spinner flash

  setSession: (session) => set({ session, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  clearAuth: () => set({ session: null, isLoading: false }),
}));

// Selectors
export const selectUser = (state: AuthState): AuthUser | null =>
  state.session?.user ?? null;

export const selectIsAuthenticated = (state: AuthState): boolean =>
  state.session !== null;
