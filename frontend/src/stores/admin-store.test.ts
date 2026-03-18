import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAdminStore } from './admin-store';
import { api } from '@/services/api';
import type { DashboardStats, AdminUser, SystemSettingItem, UsageStats } from '@/types/admin';

beforeEach(() => {
  useAdminStore.setState({
    stats: null,
    users: [],
    usersTotal: 0,
    usersPage: 1,
    usersSearch: '',
    settings: [],
    health: {},
    usage: null,
    usagePeriod: 7,
    isLoading: false,
    logs: [],
    logsTotal: 0,
    logsPage: 1,
    logsStatus: '',
  });
  vi.restoreAllMocks();
});

const makeStats = (): DashboardStats => ({
  total_users: 10,
  total_notebooks: 20,
  total_documents: 50,
  storage_bytes: 1024,
  active_users_7d: 5,
});

const makeUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'user-1',
  email: 'admin@test.com',
  name: 'Admin',
  avatar: null,
  is_admin: false,
  is_disabled: false,
  created_at: '2024-01-01T00:00:00Z',
  last_active_at: null,
  notebook_count: 3,
  document_count: 10,
  ...overrides,
});

describe('useAdminStore', () => {
  describe('fetchDashboard', () => {
    it('should fetch and set stats', async () => {
      const stats = makeStats();
      vi.spyOn(api, 'getAdminDashboard').mockResolvedValueOnce(stats);

      await useAdminStore.getState().fetchDashboard();

      expect(useAdminStore.getState().stats).toEqual(stats);
      expect(useAdminStore.getState().isLoading).toBe(false);
    });

    it('should set isLoading false on error', async () => {
      vi.spyOn(api, 'getAdminDashboard').mockRejectedValueOnce(new Error('fail'));

      await useAdminStore.getState().fetchDashboard().catch(() => {});

      expect(useAdminStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchUsers', () => {
    it('should fetch and set users', async () => {
      const users = [makeUser(), makeUser({ id: 'user-2' })];
      vi.spyOn(api, 'getAdminUsers').mockResolvedValueOnce({
        items: users,
        total: 2,
        page: 1,
        limit: 20,
      });

      await useAdminStore.getState().fetchUsers({ search: 'test', page: 1 });

      const state = useAdminStore.getState();
      expect(state.users).toEqual(users);
      expect(state.usersTotal).toBe(2);
      expect(state.usersSearch).toBe('test');
    });
  });

  describe('toggleUserDisabled', () => {
    it('should toggle disabled state of user', async () => {
      useAdminStore.setState({ users: [makeUser({ id: 'u1', is_disabled: false })] });
      vi.spyOn(api, 'updateAdminUser').mockResolvedValueOnce({});

      await useAdminStore.getState().toggleUserDisabled('u1', true);

      expect(useAdminStore.getState().users[0].is_disabled).toBe(true);
    });
  });

  describe('toggleUserAdmin', () => {
    it('should toggle admin state of user', async () => {
      useAdminStore.setState({ users: [makeUser({ id: 'u1', is_admin: false })] });
      vi.spyOn(api, 'updateAdminUser').mockResolvedValueOnce({});

      await useAdminStore.getState().toggleUserAdmin('u1', true);

      expect(useAdminStore.getState().users[0].is_admin).toBe(true);
    });
  });

  describe('deleteUsers', () => {
    it('should remove deleted users and update total', async () => {
      useAdminStore.setState({
        users: [makeUser({ id: 'u1' }), makeUser({ id: 'u2' }), makeUser({ id: 'u3' })],
        usersTotal: 3,
      });
      vi.spyOn(api, 'batchDeleteUsers').mockResolvedValueOnce({ deleted: 2 });

      await useAdminStore.getState().deleteUsers(['u1', 'u3']);

      const state = useAdminStore.getState();
      expect(state.users).toHaveLength(1);
      expect(state.users[0].id).toBe('u2');
      expect(state.usersTotal).toBe(1);
    });
  });

  describe('fetchSettings', () => {
    it('should fetch and set settings', async () => {
      const settings: SystemSettingItem[] = [
        { key: 'llm_model', value: 'qwen-plus', source: 'db', updated_at: null },
      ];
      vi.spyOn(api, 'getAdminSettings').mockResolvedValueOnce(settings);

      await useAdminStore.getState().fetchSettings();

      expect(useAdminStore.getState().settings).toEqual(settings);
    });
  });

  describe('saveSettings', () => {
    it('should save and re-fetch settings', async () => {
      const spy = vi.spyOn(api, 'updateAdminSettings').mockResolvedValueOnce({});
      vi.spyOn(api, 'getAdminSettings').mockResolvedValueOnce([]);

      await useAdminStore.getState().saveSettings({ key: 'value' });

      expect(spy).toHaveBeenCalledWith({ key: 'value' });
    });
  });

  describe('fetchHealth', () => {
    it('should fetch and set health', async () => {
      const health = { ragflow: { status: 'healthy' as const, latency_ms: 10 } };
      vi.spyOn(api, 'getAdminHealth').mockResolvedValueOnce(health);

      await useAdminStore.getState().fetchHealth();

      expect(useAdminStore.getState().health).toEqual(health);
    });
  });

  describe('fetchUsage', () => {
    it('should fetch usage with specified period', async () => {
      const usage: UsageStats = {
        period_days: 30,
        total_queries: 500,
        docs_ready: 100,
        docs_failed: 5,
        total_storage_bytes: 1024,
        success_rate: 0.95,
        queries_per_day: [],
        active_users_per_day: [],
        top_users: [],
        top_notebooks: [],
      };
      vi.spyOn(api, 'getAdminUsage').mockResolvedValueOnce(usage);

      await useAdminStore.getState().fetchUsage(30);

      const state = useAdminStore.getState();
      expect(state.usage).toEqual(usage);
      expect(state.usagePeriod).toBe(30);
    });

    it('should use default period when not specified', async () => {
      const spy = vi.spyOn(api, 'getAdminUsage').mockResolvedValueOnce({
        period_days: 7,
        total_queries: 100,
        docs_ready: 50,
        docs_failed: 2,
        total_storage_bytes: 512,
        success_rate: 0.98,
        queries_per_day: [],
        active_users_per_day: [],
        top_users: [],
        top_notebooks: [],
      });

      await useAdminStore.getState().fetchUsage();

      expect(spy).toHaveBeenCalledWith(7);
    });
  });

  describe('fetchLogs', () => {
    it('should fetch and set logs', async () => {
      const logs = [{ id: 'log-1', query: 'test', status: 'success' }];
      vi.spyOn(api, 'getAdminLogs').mockResolvedValueOnce({
        items: logs as any,
        total: 1,
        page: 1,
        limit: 50,
      });

      await useAdminStore.getState().fetchLogs({ page: 1, status: 'success' });

      const state = useAdminStore.getState();
      expect(state.logs).toEqual(logs);
      expect(state.logsTotal).toBe(1);
      expect(state.logsStatus).toBe('success');
    });
  });
});
