import { create } from "zustand";
import type { User } from "@/types/api";
import { api } from "@/services/api";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    const tokens = await api.login(email, password);
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    api.setToken(tokens.access_token);
    const user = await api.getMe();
    set({ user, isAuthenticated: true, isLoading: false });
  },

  register: async (email, name, password) => {
    const tokens = await api.register(email, name, password);
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    api.setToken(tokens.access_token);
    const user = await api.getMe();
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    api.setToken(null);
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  loadUser: async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }
    api.setToken(token);
    try {
      const user = await api.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      // Try refresh
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const tokens = await api.refreshToken(refreshToken);
          localStorage.setItem("access_token", tokens.access_token);
          localStorage.setItem("refresh_token", tokens.refresh_token);
          api.setToken(tokens.access_token);
          const user = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
          return;
        } catch {
          // Refresh failed
        }
      }
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      api.setToken(null);
      set({ isLoading: false });
    }
  },
}));
