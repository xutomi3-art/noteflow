import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotebookStore } from './notebook-store';
import { api } from '@/services/api';
import type { Notebook } from '@/types/api';

const makeNotebook = (overrides: Partial<Notebook> = {}): Notebook => ({
  id: 'nb-1',
  name: 'Test Notebook',
  emoji: '📓',
  cover_color: '#fff',
  owner_id: 'user-1',
  is_shared: false,
  user_role: 'owner',
  source_count: 0,
  member_count: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  joined_at: null,
  ...overrides,
});

beforeEach(() => {
  useNotebookStore.setState({ notebooks: [], isLoading: false });
  vi.restoreAllMocks();
});

describe('useNotebookStore', () => {
  describe('initial state', () => {
    it('should start with empty notebooks and not loading', () => {
      const state = useNotebookStore.getState();
      expect(state.notebooks).toEqual([]);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('fetchNotebooks', () => {
    it('should fetch and set notebooks', async () => {
      const notebooks = [makeNotebook(), makeNotebook({ id: 'nb-2', name: 'Second' })];
      vi.spyOn(api, 'listNotebooks').mockResolvedValueOnce(notebooks);

      await useNotebookStore.getState().fetchNotebooks();

      const state = useNotebookStore.getState();
      expect(state.notebooks).toEqual(notebooks);
      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading true during fetch', async () => {
      let resolvePromise: (value: Notebook[]) => void;
      vi.spyOn(api, 'listNotebooks').mockReturnValue(
        new Promise((resolve) => { resolvePromise = resolve; })
      );

      const fetchPromise = useNotebookStore.getState().fetchNotebooks();
      expect(useNotebookStore.getState().isLoading).toBe(true);

      resolvePromise!([]);
      await fetchPromise;
      expect(useNotebookStore.getState().isLoading).toBe(false);
    });
  });

  describe('createNotebook', () => {
    it('should create notebook and prepend to list', async () => {
      const existing = makeNotebook({ id: 'nb-old' });
      useNotebookStore.setState({ notebooks: [existing] });

      const newNb = makeNotebook({ id: 'nb-new', name: 'New' });
      vi.spyOn(api, 'createNotebook').mockResolvedValueOnce(newNb);

      const result = await useNotebookStore.getState().createNotebook({ name: 'New' });

      expect(result).toEqual(newNb);
      const state = useNotebookStore.getState();
      expect(state.notebooks[0].id).toBe('nb-new');
      expect(state.notebooks[1].id).toBe('nb-old');
    });
  });

  describe('updateNotebook', () => {
    it('should update notebook in place', async () => {
      const nb1 = makeNotebook({ id: 'nb-1', name: 'Original' });
      const nb2 = makeNotebook({ id: 'nb-2', name: 'Other' });
      useNotebookStore.setState({ notebooks: [nb1, nb2] });

      const updated = makeNotebook({ id: 'nb-1', name: 'Updated' });
      vi.spyOn(api, 'updateNotebook').mockResolvedValueOnce(updated);

      await useNotebookStore.getState().updateNotebook('nb-1', { name: 'Updated' });

      const state = useNotebookStore.getState();
      expect(state.notebooks[0].name).toBe('Updated');
      expect(state.notebooks[1].name).toBe('Other');
    });
  });

  describe('deleteNotebook', () => {
    it('should remove notebook from list', async () => {
      const nb1 = makeNotebook({ id: 'nb-1' });
      const nb2 = makeNotebook({ id: 'nb-2' });
      useNotebookStore.setState({ notebooks: [nb1, nb2] });

      vi.spyOn(api, 'deleteNotebook').mockResolvedValueOnce(undefined);

      await useNotebookStore.getState().deleteNotebook('nb-1');

      const state = useNotebookStore.getState();
      expect(state.notebooks).toHaveLength(1);
      expect(state.notebooks[0].id).toBe('nb-2');
    });
  });
});
