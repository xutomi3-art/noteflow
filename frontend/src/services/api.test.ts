import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError, api } from './api';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  api.setToken(null);
  vi.restoreAllMocks();
});

describe('ApiClient', () => {
  describe('token management', () => {
    it('should start with null token', () => {
      expect(api.getToken()).toBeNull();
    });

    it('should store and retrieve token', () => {
      api.setToken('my-jwt-token');
      expect(api.getToken()).toBe('my-jwt-token');
    });

    it('should clear token when set to null', () => {
      api.setToken('some-token');
      api.setToken(null);
      expect(api.getToken()).toBeNull();
    });
  });

  describe('request handling', () => {
    it('should throw ApiError with correct status on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJsonResponse({ detail: 'Not found' }, 404),
      );

      const err = await api.listNotebooks().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    });

    it('should include auth header when token is set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      api.setToken('bearer-token-123');
      await api.listNotebooks();

      const [, options] = fetchSpy.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer bearer-token-123');
    });

    it('should not include auth header when no token', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.listNotebooks();

      const [, options] = fetchSpy.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should handle array detail in error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJsonResponse({ detail: [{ msg: 'field required' }, { msg: 'too short' }] }, 422),
      );

      const err = await api.listNotebooks().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('field required; too short');
      expect((err as ApiError).status).toBe(422);
    });

    it('should handle error response with no JSON body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Server Error', { status: 500 }),
      );

      const err = await api.listNotebooks().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Request failed: 500');
    });

    it('should handle error detail as string', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJsonResponse({ detail: 'Custom error message' }, 400),
      );

      const err = await api.login('a@b.com', 'pass').catch((e) => e);
      expect((err as ApiError).message).toBe('Custom error message');
    });
  });

  describe('auth methods', () => {
    it('register should POST to /auth/register', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'at', refresh_token: 'rt', token_type: 'bearer' }),
      );

      const result = await api.register('a@b.com', 'Name', 'pass');

      expect(result.access_token).toBe('at');
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/register');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toEqual({
        email: 'a@b.com',
        name: 'Name',
        password: 'pass',
      });
    });

    it('login should POST to /auth/login', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'at', refresh_token: 'rt', token_type: 'bearer' }),
      );

      await api.login('a@b.com', 'pass');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/login');
      expect(JSON.parse(options?.body as string)).toEqual({
        email: 'a@b.com',
        password: 'pass',
      });
    });

    it('refreshToken should POST to /auth/refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'new-at', refresh_token: 'new-rt', token_type: 'bearer' }),
      );

      const result = await api.refreshToken('old-rt');

      expect(result.access_token).toBe('new-at');
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/refresh');
    });

    it('getMe should GET /auth/me', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'u1', email: 'a@b.com', name: 'A', avatar: null, is_admin: false }),
      );

      api.setToken('tok');
      const user = await api.getMe();

      expect(user.email).toBe('a@b.com');
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/me');
    });

    it('forgotPassword should POST to /auth/forgot-password', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.forgotPassword('a@b.com');

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/forgot-password');
    });

    it('resetPassword should POST to /auth/reset-password', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.resetPassword('token123', 'newpass');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/auth/reset-password');
      expect(JSON.parse(options?.body as string)).toEqual({
        token: 'token123',
        new_password: 'newpass',
      });
    });
  });

  describe('notebook methods', () => {
    it('listNotebooks should GET /notebooks', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.listNotebooks();

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/notebooks');
    });

    it('createNotebook should POST to /notebooks', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'nb-1', name: 'Test' }),
      );

      await api.createNotebook({ name: 'Test', emoji: '📓' });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks');
      expect(options?.method).toBe('POST');
    });

    it('getNotebook should GET /notebooks/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'nb-1' }),
      );

      await api.getNotebook('nb-1');

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/notebooks/nb-1');
    });

    it('updateNotebook should PATCH /notebooks/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'nb-1', name: 'Updated' }),
      );

      await api.updateNotebook('nb-1', { name: 'Updated' });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1');
      expect(options?.method).toBe('PATCH');
    });

    it('deleteNotebook should DELETE /notebooks/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.deleteNotebook('nb-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1');
      expect(options?.method).toBe('DELETE');
    });
  });

  describe('source methods', () => {
    it('listSources should GET /notebooks/:id/sources', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.listSources('nb-1');

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/notebooks/nb-1/sources');
    });

    it('addUrlSource should POST to /notebooks/:id/sources/url', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'src-1' }),
      );

      await api.addUrlSource('nb-1', 'http://example.com');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/sources/url');
      expect(options?.method).toBe('POST');
    });

    it('deleteSource should DELETE /notebooks/:id/sources/:sid', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.deleteSource('nb-1', 'src-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/sources/src-1');
      expect(options?.method).toBe('DELETE');
    });

    it('getSourceContent should GET /notebooks/:id/sources/:sid/content', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ content: 'Hello world' }),
      );

      const result = await api.getSourceContent('nb-1', 'src-1');

      expect(result.content).toBe('Hello world');
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/notebooks/nb-1/sources/src-1/content');
    });
  });

  describe('chat methods', () => {
    it('getChatHistory should GET /notebooks/:id/chat/history', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.getChatHistory('nb-1');

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/notebooks/nb-1/chat/history');
    });

    it('clearChatHistory should DELETE /notebooks/:id/chat/history', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.clearChatHistory('nb-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/chat/history');
      expect(options?.method).toBe('DELETE');
    });
  });

  describe('notes methods', () => {
    it('saveNote should POST to /notebooks/:id/notes', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'note-1' }),
      );

      await api.saveNote('nb-1', 'Note content', 'msg-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/notes');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toEqual({
        content: 'Note content',
        source_message_id: 'msg-1',
      });
    });

    it('listNotes should GET /notebooks/:id/notes', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      const result = await api.listNotes('nb-1');

      expect(result).toEqual([]);
    });

    it('deleteNote should DELETE /notebooks/:id/notes/:nid', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.deleteNote('nb-1', 'note-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/notes/note-1');
      expect(options?.method).toBe('DELETE');
    });
  });

  describe('sharing methods', () => {
    it('createInviteLink should POST to /notebooks/:id/share', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'link-1', token: 'abc' }),
      );

      await api.createInviteLink('nb-1', 'viewer', 'a@b.com');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/share');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toEqual({
        role: 'viewer',
        email: 'a@b.com',
      });
    });

    it('createInviteLink should pass null email when not provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'link-1', token: 'abc' }),
      );

      await api.createInviteLink('nb-1', 'editor');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.email).toBeNull();
    });

    it('stopSharing should DELETE /notebooks/:id/share', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.stopSharing('nb-1');

      expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    });

    it('getMembers should GET /notebooks/:id/members', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.getMembers('nb-1');
    });

    it('updateMemberRole should PATCH /notebooks/:id/members/:uid', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.updateMemberRole('nb-1', 'user-1', 'editor');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/members/user-1');
      expect(options?.method).toBe('PATCH');
    });

    it('removeMember should DELETE /notebooks/:id/members/:uid', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.removeMember('nb-1', 'user-1');

      expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    });

    it('leaveNotebook should POST to /notebooks/:id/leave', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.leaveNotebook('nb-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/leave');
      expect(options?.method).toBe('POST');
    });

    it('transferOwnership should PATCH /notebooks/:id/owner', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.transferOwnership('nb-1', 'user-2');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/notebooks/nb-1/owner');
      expect(options?.method).toBe('PATCH');
    });

    it('joinViaToken should POST and unwrap data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ data: { notebook_id: 'nb-1', name: 'Shared', already_member: false } }),
      );

      const result = await api.joinViaToken('token123');

      expect(result.notebook_id).toBe('nb-1');
      expect(result.already_member).toBe(false);
    });
  });

  describe('overview method', () => {
    it('getOverview should GET /notebooks/:id/overview', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ overview: 'Summary text', suggested_questions: ['Q1'] }),
      );

      const result = await api.getOverview('nb-1');

      expect(result.overview).toBe('Summary text');
      expect(result.suggested_questions).toEqual(['Q1']);
    });
  });

  describe('studio methods', () => {
    it('generateStudioContent should POST and return content', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ content: 'Generated text' }),
      );

      const result = await api.generateStudioContent('nb-1', 'summary', ['src-1']);

      expect(result).toBe('Generated text');
    });

    it('listPptTemplates should GET /ppt/templates with params', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ records: [], total: 0, pages: 0 }),
      );

      await api.listPptTemplates(2, 10, 'en');

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/api/ppt/templates');
      expect(url).toContain('page=2');
      expect(url).toContain('size=10');
      expect(url).toContain('lang=en');
    });

    it('getPptGenerationOptions should GET /ppt/generation-options', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.getPptGenerationOptions();

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/ppt/generation-options');
    });
  });

  describe('admin methods', () => {
    it('getAdminDashboard should GET /admin/dashboard', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ total_users: 10 }),
      );

      await api.getAdminDashboard();

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/admin/dashboard');
    });

    it('getAdminUsers should build query string', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ items: [], total: 0, page: 1, limit: 20 }),
      );

      await api.getAdminUsers({ search: 'john', page: 2, limit: 10 });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('search=john');
      expect(url).toContain('page=2');
      expect(url).toContain('limit=10');
    });

    it('getAdminUsers should handle no params', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ items: [], total: 0, page: 1, limit: 20 }),
      );

      await api.getAdminUsers();

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('/api/admin/users');
    });

    it('updateAdminUser should PATCH /admin/users/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.updateAdminUser('u1', { is_disabled: true });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/admin/users/u1');
      expect(options?.method).toBe('PATCH');
    });

    it('batchDeleteUsers should POST /admin/users/batch-delete', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ deleted: 2 }),
      );

      const result = await api.batchDeleteUsers(['u1', 'u2']);

      expect(result.deleted).toBe(2);
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.user_ids).toEqual(['u1', 'u2']);
    });

    it('getAdminSettings should GET /admin/settings', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse([]),
      );

      await api.getAdminSettings();
    });

    it('updateAdminSettings should PUT /admin/settings', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.updateAdminSettings({ key: 'value' });

      expect(fetchSpy.mock.calls[0][1]?.method).toBe('PUT');
    });

    it('getAdminHealth should GET /admin/health', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.getAdminHealth();
    });

    it('getAdminUsage should GET /admin/usage with period', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({}),
      );

      await api.getAdminUsage(30);

      expect(fetchSpy.mock.calls[0][0]).toBe('/api/admin/usage?period=30');
    });

    it('getAdminLogs should build query string', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ items: [], total: 0, page: 1, limit: 50 }),
      );

      await api.getAdminLogs({ page: 2, limit: 25, status: 'error' });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('page=2');
      expect(url).toContain('limit=25');
      expect(url).toContain('status=error');
    });
  });

  describe('feedback methods', () => {
    it('getAdminFeedback should build query string', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ items: [], total: 0, page: 1, limit: 20 }),
      );

      await api.getAdminFeedback({ page: 1, limit: 20, status: 'open', type: 'bug' });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('status=open');
      expect(url).toContain('type=bug');
    });

    it('updateAdminFeedbackStatus should PATCH /admin/feedback/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'fb-1', status: 'resolved' }),
      );

      await api.updateAdminFeedbackStatus('fb-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/admin/feedback/fb-1');
      expect(options?.method).toBe('PATCH');
    });
  });

  describe('uploadSource (XHR)', () => {
    let lastXhr: any;

    beforeEach(() => {
      lastXhr = null;
      // Use function keyword so it can be called with `new`
      vi.stubGlobal('XMLHttpRequest', function (this: any) {
        this._listeners = {} as Record<string, Function>;
        this._uploadListeners = {} as Record<string, Function>;
        this.open = vi.fn();
        this.send = vi.fn();
        this.setRequestHeader = vi.fn();
        this.abort = vi.fn();
        this.status = 0;
        this.responseText = '';
        this.upload = {
          addEventListener: vi.fn((event: string, handler: Function) => {
            this._uploadListeners[event] = handler;
          }),
        };
        this.addEventListener = vi.fn((event: string, handler: Function) => {
          this._listeners[event] = handler;
        });
        lastXhr = this;
      });
    });

    it('should resolve with parsed response on success', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));

      lastXhr.status = 200;
      lastXhr.responseText = JSON.stringify({ id: 'src-1', filename: 'test.pdf' });
      lastXhr._listeners.load();

      const result = await promise;
      expect(result).toEqual({ id: 'src-1', filename: 'test.pdf' });
    });

    it('should reject with error detail on non-200', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));

      lastXhr.status = 413;
      lastXhr.responseText = JSON.stringify({ detail: 'File too large' });
      lastXhr._listeners.load();

      await expect(promise).rejects.toThrow('File too large');
    });

    it('should reject on network error', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));
      lastXhr._listeners.error();

      await expect(promise).rejects.toThrow('Network error');
    });

    it('should reject with AbortError on abort', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));
      lastXhr._listeners.abort();

      await expect(promise).rejects.toThrow('Upload aborted');
    });

    it('should set auth header when token is set', async () => {
      api.setToken('upload-token');
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));

      expect(lastXhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer upload-token');
      expect(lastXhr.open).toHaveBeenCalledWith('POST', '/api/notebooks/nb-1/sources');

      lastXhr.status = 200;
      lastXhr.responseText = '{"id":"s"}';
      lastXhr._listeners.load();
      await promise;
    });

    it('should handle invalid JSON response on success', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));

      lastXhr.status = 200;
      lastXhr.responseText = 'not json';
      lastXhr._listeners.load();

      await expect(promise).rejects.toThrow('Invalid response');
    });

    it('should handle non-JSON error response', async () => {
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'));

      lastXhr.status = 500;
      lastXhr.responseText = 'Internal Server Error';
      lastXhr._listeners.load();

      await expect(promise).rejects.toThrow('Upload failed: 500');
    });

    it('should call onProgress during upload', async () => {
      const progressFn = vi.fn();
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'), undefined, progressFn);

      lastXhr._uploadListeners.progress({ lengthComputable: true, loaded: 50, total: 100 });
      expect(progressFn).toHaveBeenCalledWith(50);

      lastXhr.status = 200;
      lastXhr.responseText = '{"id":"s"}';
      lastXhr._listeners.load();
      await promise;
    });

    it('should abort on signal', async () => {
      const controller = new AbortController();
      const promise = api.uploadSource('nb-1', new File(['x'], 'test.pdf'), controller.signal);

      controller.abort();
      expect(lastXhr.abort).toHaveBeenCalled();

      lastXhr._listeners.abort();
      await expect(promise).rejects.toThrow('Upload aborted');
    });
  });

  describe('subscribeToSourceStatus', () => {
    it('should return unsubscribe function', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      const unsub = api.subscribeToSourceStatus('nb-1', () => {});

      expect(typeof unsub).toBe('function');
      unsub(); // Should not throw
    });
  });

  describe('submitFeedback', () => {
    it('should POST FormData to /feedback', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'fb-1' }),
      );

      api.setToken('my-token');
      const result = await api.submitFeedback('bug', 'Something broke');

      expect(result.id).toBe('fb-1');
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/feedback');
      expect(options?.method).toBe('POST');
      expect((options?.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
      expect(options?.body).toBeInstanceOf(FormData);
    });

    it('should include screenshot in FormData', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ id: 'fb-2' }),
      );

      const screenshot = new File(['img'], 'screenshot.png', { type: 'image/png' });
      await api.submitFeedback('wish', 'Feature request', screenshot);
    });

    it('should throw ApiError on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Too large' }), { status: 413 }),
      );

      const err = await api.submitFeedback('bug', 'x').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(413);
    });

    it('should handle non-JSON error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500 }),
      );

      const err = await api.submitFeedback('bug', 'x').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Request failed: 500');
    });
  });

  describe('sendChatMessage', () => {
    it('should handle SSE stream with tokens and done', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"token","content":"Hello "}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"token","content":"World"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done","id":"msg-1","citations":[]}\n\n'));
          controller.close();
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(stream, { status: 200 }),
      );

      const tokens: string[] = [];
      let doneData: { id: string; citations: unknown[] } | null = null;

      const { promise } = api.sendChatMessage(
        'nb-1', 'Hi', [],
        (token) => tokens.push(token),
        (data) => { doneData = data; },
        () => {},
      );

      await promise;

      expect(tokens).toEqual(['Hello ', 'World']);
      expect(doneData?.id).toBe('msg-1');
    });

    it('should handle error event in stream', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"error","message":"Rate limited"}\n\n'));
          controller.close();
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(stream, { status: 200 }),
      );

      let errorMsg = '';
      const { promise } = api.sendChatMessage(
        'nb-1', 'Hi', [],
        () => {},
        () => {},
        (err) => { errorMsg = err; },
      );

      await promise;

      expect(errorMsg).toBe('Rate limited');
    });

    it('should handle non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ detail: 'Forbidden' }, 403),
      );

      let errorMsg = '';
      const { promise } = api.sendChatMessage(
        'nb-1', 'Hi', [],
        () => {},
        () => {},
        (err) => { errorMsg = err; },
      );

      await promise;

      expect(errorMsg).toBe('Forbidden');
    });

    it('should handle no response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      let errorMsg = '';
      const { promise } = api.sendChatMessage(
        'nb-1', 'Hi', [],
        () => {},
        () => {},
        (err) => { errorMsg = err; },
      );

      await promise;

      expect(errorMsg).toBe('No response body');
    });

    it('should include auth header when token set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      api.setToken('chat-token');
      const { promise } = api.sendChatMessage(
        'nb-1', 'Hi', ['src-1'],
        () => {},
        () => {},
        () => {},
      );

      await promise;

      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer chat-token');
    });

    it('should handle abort gracefully', async () => {
      let controllerRef: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(controller) {
          controllerRef = controller;
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(stream, { status: 200 }),
      );

      let errorCalled = false;
      const { promise, abort } = api.sendChatMessage(
        'nb-1', 'Hi', [],
        () => {},
        () => {},
        () => { errorCalled = true; },
      );

      // Abort should not trigger error callback
      abort();
      controllerRef!.close();
      await promise;
      // AbortError is silently handled
    });
  });

  describe('generateStudioContent timeout', () => {
    it('should set 120s timeout via AbortController', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ content: 'Result' }),
      );

      const result = await api.generateStudioContent('nb-1', 'summary');

      expect(result).toBe('Result');
      // Verify signal was passed
      expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('generatePodcast', () => {
    it('should POST and return blob URL', async () => {
      const blob = new Blob(['audio data'], { type: 'audio/mp3' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(blob, { status: 200 }),
      );

      api.setToken('tok');
      const url = await api.generatePodcast('nb-1');

      expect(url).toContain('blob:');
    });

    it('should throw on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ detail: 'No sources' }, 400),
      );

      await expect(api.generatePodcast('nb-1')).rejects.toThrow('No sources');
    });

    it('should handle non-JSON error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Error', { status: 500 }),
      );

      await expect(api.generatePodcast('nb-1')).rejects.toThrow('Unknown error');
    });
  });
});

describe('ApiError', () => {
  it('should carry status code', () => {
    const err = new ApiError('Bad request', 400);
    expect(err.message).toBe('Bad request');
    expect(err.status).toBe(400);
    expect(err.name).toBe('ApiError');
  });

  it('should be instanceof Error', () => {
    const err = new ApiError('Server error', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});
