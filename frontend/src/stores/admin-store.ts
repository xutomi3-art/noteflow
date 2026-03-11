import { create } from "zustand";
import { api } from "@/services/api";
import type { DashboardStats, AdminUser, SystemSettingItem, ServiceHealth } from "@/types/admin";

interface AdminState {
  stats: DashboardStats | null;
  users: AdminUser[];
  usersTotal: number;
  usersPage: number;
  usersSearch: string;
  settings: SystemSettingItem[];
  health: Record<string, ServiceHealth>;
  isLoading: boolean;

  fetchDashboard: () => Promise<void>;
  fetchUsers: (params?: { search?: string; page?: number }) => Promise<void>;
  toggleUserDisabled: (userId: string, isDisabled: boolean) => Promise<void>;
  toggleUserAdmin: (userId: string, isAdmin: boolean) => Promise<void>;
  fetchSettings: () => Promise<void>;
  saveSettings: (settings: Record<string, string>) => Promise<void>;
  fetchHealth: () => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  stats: null,
  users: [],
  usersTotal: 0,
  usersPage: 1,
  usersSearch: "",
  settings: [],
  health: {},
  isLoading: false,

  fetchDashboard: async () => {
    set({ isLoading: true });
    try {
      const stats = await api.getAdminDashboard();
      set({ stats });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchUsers: async (params) => {
    const search = params?.search ?? get().usersSearch;
    const page = params?.page ?? get().usersPage;
    set({ isLoading: true, usersSearch: search, usersPage: page });
    try {
      const data = await api.getAdminUsers({ search, page, limit: 20 });
      set({ users: data.items, usersTotal: data.total, usersPage: data.page });
    } finally {
      set({ isLoading: false });
    }
  },

  toggleUserDisabled: async (userId, isDisabled) => {
    await api.updateAdminUser(userId, { is_disabled: isDisabled });
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, is_disabled: isDisabled } : u
      ),
    }));
  },

  toggleUserAdmin: async (userId, isAdmin) => {
    await api.updateAdminUser(userId, { is_admin: isAdmin });
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, is_admin: isAdmin } : u
      ),
    }));
  },

  fetchSettings: async () => {
    set({ isLoading: true });
    try {
      const settings = await api.getAdminSettings();
      set({ settings });
    } finally {
      set({ isLoading: false });
    }
  },

  saveSettings: async (settingsMap) => {
    await api.updateAdminSettings(settingsMap);
    await get().fetchSettings();
  },

  fetchHealth: async () => {
    set({ isLoading: true });
    try {
      const health = await api.getAdminHealth();
      set({ health });
    } finally {
      set({ isLoading: false });
    }
  },
}));
