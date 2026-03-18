import { create } from 'zustand';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;  // null = loading, true = onboarding, false = login/app
  setToken: (token: string) => void;
  clearToken: () => void;
  setSetupRequired: (value: boolean) => void;
}

const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthenticated: false,
  setupRequired: null,
  setToken: (token: string) => set({ token, isAuthenticated: true }),
  clearToken: () => set({ token: null, isAuthenticated: false }),
  setSetupRequired: (value: boolean) => set({ setupRequired: value }),
}));

export default useAuthStore;
