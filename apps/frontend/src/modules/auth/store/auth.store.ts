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

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,

  setSession: (session) => set({ session, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  clearAuth: () => set({ session: null, isLoading: false }),
}));

// Selectors
export const selectUser = (state: AuthState): AuthUser | null =>
  state.session?.user ?? null;

export const selectIsAuthenticated = (state: AuthState): boolean =>
  state.session !== null;
