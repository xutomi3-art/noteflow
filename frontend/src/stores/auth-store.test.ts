import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './auth-store';
import { api, ApiError } from '@/services/api';

// Reset store state between tests
beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });
  api.setToken(null);
  vi.restoreAllMocks();
});

describe('useAuthStore', () => {
  describe('initial state', () => {
    it('should start unauthenticated and loading', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
    });
  });

  describe('login', () => {
    it('should set user and tokens on successful login', async () => {
      vi.spyOn(api, 'login').mockResolvedValueOnce({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        token_type: 'bearer',
      });
      vi.spyOn(api, 'getMe').mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        avatar: null,
        is_admin: false,
      });

      await useAuthStore.getState().login('test@example.com', 'password');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.email).toBe('test@example.com');
      expect(localStorage.getItem('access_token')).toBe('access-123');
      expect(localStorage.getItem('refresh_token')).toBe('refresh-456');
    });

    it('should propagate error on failed login', async () => {
      vi.spyOn(api, 'login').mockRejectedValueOnce(new ApiError('Invalid credentials', 401));

      await expect(
        useAuthStore.getState().login('test@example.com', 'wrong')
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('register', () => {
    it('should set user and tokens on successful register', async () => {
      vi.spyOn(api, 'register').mockResolvedValueOnce({
        access_token: 'reg-access',
        refresh_token: 'reg-refresh',
        token_type: 'bearer',
      });
      vi.spyOn(api, 'getMe').mockResolvedValueOnce({
        id: 'user-2',
        email: 'new@example.com',
        name: 'New User',
        avatar: null,
        is_admin: false,
      });

      await useAuthStore.getState().register('new@example.com', 'New User', 'password');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.name).toBe('New User');
      expect(localStorage.getItem('access_token')).toBe('reg-access');
      expect(localStorage.getItem('refresh_token')).toBe('reg-refresh');
    });
  });

  describe('logout', () => {
    it('should clear user state and tokens', () => {
      // Set up authenticated state
      useAuthStore.setState({
        user: { id: '1', email: 'a@b.com', name: 'A', avatar: null, is_admin: false },
        isAuthenticated: true,
        isLoading: false,
      });
      localStorage.setItem('access_token', 'tok');
      localStorage.setItem('refresh_token', 'ref');

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });
  });

  describe('setTokens', () => {
    it('should set tokens and load user', async () => {
      vi.spyOn(api, 'getMe').mockResolvedValueOnce({
        id: 'user-3',
        email: 'sso@example.com',
        name: 'SSO User',
        avatar: null,
        is_admin: false,
      });

      await useAuthStore.getState().setTokens('sso-access', 'sso-refresh');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.email).toBe('sso@example.com');
      expect(localStorage.getItem('access_token')).toBe('sso-access');
      expect(localStorage.getItem('refresh_token')).toBe('sso-refresh');
    });
  });

  describe('loadUser', () => {
    it('should set isLoading false when no token exists', async () => {
      await useAuthStore.getState().loadUser();
      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
    });

    it('should load user when valid token exists', async () => {
      localStorage.setItem('access_token', 'valid-token');
      vi.spyOn(api, 'getMe').mockResolvedValueOnce({
        id: 'user-2',
        email: 'loaded@example.com',
        name: 'Loaded',
        avatar: null,
        is_admin: false,
      });

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.email).toBe('loaded@example.com');
    });

    it('should attempt refresh on 401 error', async () => {
      localStorage.setItem('access_token', 'expired');
      localStorage.setItem('refresh_token', 'valid-refresh');

      vi.spyOn(api, 'getMe')
        .mockRejectedValueOnce(new ApiError('Unauthorized', 401))
        .mockResolvedValueOnce({
          id: 'user-4',
          email: 'refreshed@example.com',
          name: 'Refreshed',
          avatar: null,
          is_admin: false,
        });

      vi.spyOn(api, 'refreshToken').mockResolvedValueOnce({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'bearer',
      });

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.email).toBe('refreshed@example.com');
      expect(localStorage.getItem('access_token')).toBe('new-access');
    });

    it('should clear tokens when refresh also fails', async () => {
      localStorage.setItem('access_token', 'expired');
      localStorage.setItem('refresh_token', 'also-expired');

      vi.spyOn(api, 'getMe').mockRejectedValueOnce(new ApiError('Unauthorized', 401));
      vi.spyOn(api, 'refreshToken').mockRejectedValueOnce(new ApiError('Unauthorized', 401));

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });

    it('should clear tokens on 401 when no refresh token exists', async () => {
      localStorage.setItem('access_token', 'expired');

      vi.spyOn(api, 'getMe').mockRejectedValueOnce(new ApiError('Unauthorized', 401));

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
    });

    it('should keep tokens on network error (non-401)', async () => {
      localStorage.setItem('access_token', 'valid');
      localStorage.setItem('refresh_token', 'valid-refresh');

      vi.spyOn(api, 'getMe').mockRejectedValueOnce(new Error('Network error'));

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      // Should assume still authenticated on network error
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(localStorage.getItem('access_token')).toBe('valid');
    });
  });
});
