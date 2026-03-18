import { create } from 'zustand';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;  // null = loading, true = onboarding, false = login/app
  setToken: (token: string) => void;
  clearToken: () => void;
  setSetupRequired: (value: boolean) => void;
}

const STORAGE_KEY = 'vce_auth_token';

const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(STORAGE_KEY),
  isAuthenticated: !!localStorage.getItem(STORAGE_KEY),
  setupRequired: null,
  setToken: (token: string) => {
    localStorage.setItem(STORAGE_KEY, token);
    set({ token, isAuthenticated: true });
  },
  clearToken: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, isAuthenticated: false });
  },
  setSetupRequired: (value: boolean) => set({ setupRequired: value }),
}));

export default useAuthStore;
