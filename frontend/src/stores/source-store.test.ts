import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSourceStore } from './source-store';
import { api } from '@/services/api';
import type { Source } from '@/types/api';

const makeSource = (overrides: Partial<Source> = {}): Source => ({
  id: 'src-1',
  notebook_id: 'nb-1',
  filename: 'doc.pdf',
  file_type: 'pdf',
  file_size: 1024,
  status: 'ready',
  error_message: null,
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  useSourceStore.setState({
    sources: [],
    selectedIds: new Set(),
    isLoading: false,
    unsubscribe: null,
    activeSourceId: null,
    activeSourceContent: null,
    isLoadingContent: false,
    highlightExcerpt: null,
  });
  vi.restoreAllMocks();
});

describe('useSourceStore', () => {
  describe('initial state', () => {
    it('should start empty', () => {
      const state = useSourceStore.getState();
      expect(state.sources).toEqual([]);
      expect(state.selectedIds.size).toBe(0);
      expect(state.isLoading).toBe(false);
      expect(state.activeSourceId).toBeNull();
    });
  });

  describe('fetchSources', () => {
    it('should fetch sources and auto-select ready ones on initial load', async () => {
      const sources = [
        makeSource({ id: 'src-1', status: 'ready' }),
        makeSource({ id: 'src-2', status: 'parsing' }),
        makeSource({ id: 'src-3', status: 'ready' }),
      ];
      vi.spyOn(api, 'listSources').mockResolvedValueOnce(sources);

      await useSourceStore.getState().fetchSources('nb-1');

      const state = useSourceStore.getState();
      expect(state.sources).toEqual(sources);
      expect(state.selectedIds.has('src-1')).toBe(true);
      expect(state.selectedIds.has('src-2')).toBe(false);
      expect(state.selectedIds.has('src-3')).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should preserve existing selections on subsequent fetch', async () => {
      useSourceStore.setState({ selectedIds: new Set(['src-1']) });
      const sources = [
        makeSource({ id: 'src-1', status: 'ready' }),
        makeSource({ id: 'src-2', status: 'ready' }),
      ];
      vi.spyOn(api, 'listSources').mockResolvedValueOnce(sources);

      await useSourceStore.getState().fetchSources('nb-1');

      const state = useSourceStore.getState();
      // Should keep existing selections, not auto-select all
      expect(state.selectedIds.has('src-1')).toBe(true);
      expect(state.selectedIds.has('src-2')).toBe(false);
    });

    it('should set isLoading false on error', async () => {
      vi.spyOn(api, 'listSources').mockRejectedValueOnce(new Error('fail'));

      await useSourceStore.getState().fetchSources('nb-1').catch(() => {});

      expect(useSourceStore.getState().isLoading).toBe(false);
    });
  });

  describe('uploadSource', () => {
    it('should upload source and prepend to list', async () => {
      const newSource = makeSource({ id: 'src-new', status: 'uploading' });
      vi.spyOn(api, 'uploadSource').mockResolvedValueOnce(newSource);

      useSourceStore.setState({ sources: [makeSource({ id: 'src-existing' })] });

      const result = await useSourceStore.getState().uploadSource('nb-1', new File(['x'], 'test.pdf'));

      expect(result).toEqual(newSource);
      const state = useSourceStore.getState();
      expect(state.sources[0].id).toBe('src-new');
      expect(state.sources[1].id).toBe('src-existing');
    });
  });

  describe('deleteSource', () => {
    it('should remove source and deselect it', async () => {
      useSourceStore.setState({
        sources: [makeSource({ id: 'src-1' }), makeSource({ id: 'src-2' })],
        selectedIds: new Set(['src-1', 'src-2']),
      });
      vi.spyOn(api, 'deleteSource').mockResolvedValueOnce(undefined);

      await useSourceStore.getState().deleteSource('nb-1', 'src-1');

      const state = useSourceStore.getState();
      expect(state.sources).toHaveLength(1);
      expect(state.sources[0].id).toBe('src-2');
      expect(state.selectedIds.has('src-1')).toBe(false);
      expect(state.selectedIds.has('src-2')).toBe(true);
    });
  });

  describe('toggleSelect', () => {
    it('should add source to selection when not selected', () => {
      useSourceStore.setState({ selectedIds: new Set() });

      useSourceStore.getState().toggleSelect('src-1');

      expect(useSourceStore.getState().selectedIds.has('src-1')).toBe(true);
    });

    it('should remove source from selection when already selected', () => {
      useSourceStore.setState({ selectedIds: new Set(['src-1']) });

      useSourceStore.getState().toggleSelect('src-1');

      expect(useSourceStore.getState().selectedIds.has('src-1')).toBe(false);
    });
  });

  describe('selectAll / deselectAll', () => {
    it('selectAll should select only ready sources', () => {
      useSourceStore.setState({
        sources: [
          makeSource({ id: 'src-1', status: 'ready' }),
          makeSource({ id: 'src-2', status: 'parsing' }),
          makeSource({ id: 'src-3', status: 'ready' }),
        ],
      });

      useSourceStore.getState().selectAll();

      const ids = useSourceStore.getState().selectedIds;
      expect(ids.has('src-1')).toBe(true);
      expect(ids.has('src-2')).toBe(false);
      expect(ids.has('src-3')).toBe(true);
    });

    it('deselectAll should clear all selections', () => {
      useSourceStore.setState({ selectedIds: new Set(['src-1', 'src-2']) });

      useSourceStore.getState().deselectAll();

      expect(useSourceStore.getState().selectedIds.size).toBe(0);
    });
  });

  describe('subscribeStatus', () => {
    it('should unsubscribe previous listener and subscribe to new one', () => {
      const prevUnsub = vi.fn();
      useSourceStore.setState({ unsubscribe: prevUnsub });

      const newUnsub = vi.fn();
      vi.spyOn(api, 'subscribeToSourceStatus').mockReturnValue(newUnsub);

      useSourceStore.getState().subscribeStatus('nb-1');

      expect(prevUnsub).toHaveBeenCalled();
      expect(useSourceStore.getState().unsubscribe).toBe(newUnsub);
    });

    it('should update known source status on source_status event', () => {
      const sources = [
        makeSource({ id: 'src-1', status: 'parsing' }),
        makeSource({ id: 'src-2', status: 'ready' }),
      ];
      useSourceStore.setState({ sources, selectedIds: new Set(['src-2']) });

      let eventHandler: (event: { type: string; source_id: string; status: string; error?: string }) => void;
      vi.spyOn(api, 'subscribeToSourceStatus').mockImplementation((_nbId, onEvent) => {
        eventHandler = onEvent;
        return vi.fn();
      });

      useSourceStore.getState().subscribeStatus('nb-1');

      // Fire event for known source becoming ready
      eventHandler!({ type: 'source_status', source_id: 'src-1', status: 'ready' });

      const state = useSourceStore.getState();
      expect(state.sources[0].status).toBe('ready');
      // Should auto-select newly ready source
      expect(state.selectedIds.has('src-1')).toBe(true);
    });

    it('should handle source_status event for failed source', () => {
      const sources = [makeSource({ id: 'src-1', status: 'parsing' })];
      useSourceStore.setState({ sources, selectedIds: new Set() });

      let eventHandler: (event: { type: string; source_id: string; status: string; error?: string }) => void;
      vi.spyOn(api, 'subscribeToSourceStatus').mockImplementation((_nbId, onEvent) => {
        eventHandler = onEvent;
        return vi.fn();
      });

      useSourceStore.getState().subscribeStatus('nb-1');

      eventHandler!({ type: 'source_status', source_id: 'src-1', status: 'failed', error: 'Parse error' });

      const state = useSourceStore.getState();
      expect(state.sources[0].status).toBe('failed');
      expect(state.sources[0].error_message).toBe('Parse error');
    });

    it('should debounce refetch for unknown sources', () => {
      vi.useFakeTimers();
      useSourceStore.setState({ sources: [], isLoading: false });

      let eventHandler: (event: { type: string; source_id: string; status: string }) => void;
      vi.spyOn(api, 'subscribeToSourceStatus').mockImplementation((_nbId, onEvent) => {
        eventHandler = onEvent;
        return vi.fn();
      });

      const fetchSpy = vi.spyOn(api, 'listSources').mockResolvedValue([]);

      useSourceStore.getState().subscribeStatus('nb-1');

      // Fire event for unknown source
      eventHandler!({ type: 'source_status', source_id: 'unknown-src', status: 'ready' });

      // Should not immediately fetch
      expect(fetchSpy).not.toHaveBeenCalled();

      // After debounce
      vi.advanceTimersByTime(600);
      expect(fetchSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should ignore non-source_status events', () => {
      useSourceStore.setState({ sources: [makeSource({ id: 'src-1' })] });

      let eventHandler: (event: { type: string; source_id: string; status: string }) => void;
      vi.spyOn(api, 'subscribeToSourceStatus').mockImplementation((_nbId, onEvent) => {
        eventHandler = onEvent;
        return vi.fn();
      });

      useSourceStore.getState().subscribeStatus('nb-1');

      // Fire non-source_status event — should be a no-op
      eventHandler!({ type: 'heartbeat', source_id: '', status: '' });

      // No changes
      expect(useSourceStore.getState().sources[0].status).toBe('ready');
    });
  });

  describe('setActiveSource', () => {
    it('should clear active source when null', async () => {
      useSourceStore.setState({ activeSourceId: 'src-1', activeSourceContent: 'content' });

      await useSourceStore.getState().setActiveSource('nb-1', null);

      const state = useSourceStore.getState();
      expect(state.activeSourceId).toBeNull();
      expect(state.activeSourceContent).toBeNull();
    });

    it('should update highlight when same source re-selected', async () => {
      useSourceStore.setState({ activeSourceId: 'src-1', activeSourceContent: 'content' });

      await useSourceStore.getState().setActiveSource('nb-1', 'src-1', 'new excerpt');

      expect(useSourceStore.getState().highlightExcerpt).toBe('new excerpt');
    });

    it('should load content for new source', async () => {
      vi.spyOn(api, 'getSourceContent').mockResolvedValueOnce({ content: 'Loaded content' });

      await useSourceStore.getState().setActiveSource('nb-1', 'src-1');

      const state = useSourceStore.getState();
      expect(state.activeSourceId).toBe('src-1');
      expect(state.activeSourceContent).toBe('Loaded content');
      expect(state.isLoadingContent).toBe(false);
    });

    it('should handle content load error', async () => {
      vi.spyOn(api, 'getSourceContent').mockRejectedValueOnce(new Error('fail'));

      await useSourceStore.getState().setActiveSource('nb-1', 'src-1');

      const state = useSourceStore.getState();
      expect(state.activeSourceContent).toBeNull();
      expect(state.isLoadingContent).toBe(false);
    });
  });

  describe('clearActiveSource', () => {
    it('should clear all active source state', () => {
      useSourceStore.setState({
        activeSourceId: 'src-1',
        activeSourceContent: 'content',
        isLoadingContent: true,
        highlightExcerpt: 'excerpt',
      });

      useSourceStore.getState().clearActiveSource();

      const state = useSourceStore.getState();
      expect(state.activeSourceId).toBeNull();
      expect(state.activeSourceContent).toBeNull();
      expect(state.isLoadingContent).toBe(false);
      expect(state.highlightExcerpt).toBeNull();
    });
  });

  describe('setHighlightExcerpt', () => {
    it('should set highlight excerpt', () => {
      useSourceStore.getState().setHighlightExcerpt('test excerpt');
      expect(useSourceStore.getState().highlightExcerpt).toBe('test excerpt');
    });

    it('should clear highlight excerpt with null', () => {
      useSourceStore.setState({ highlightExcerpt: 'old' });
      useSourceStore.getState().setHighlightExcerpt(null);
      expect(useSourceStore.getState().highlightExcerpt).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should call unsubscribe and reset state', () => {
      const unsubFn = vi.fn();
      useSourceStore.setState({
        sources: [makeSource()],
        selectedIds: new Set(['src-1']),
        unsubscribe: unsubFn,
        activeSourceId: 'src-1',
        activeSourceContent: 'content',
      });

      useSourceStore.getState().cleanup();

      expect(unsubFn).toHaveBeenCalled();
      const state = useSourceStore.getState();
      expect(state.sources).toEqual([]);
      expect(state.selectedIds.size).toBe(0);
      expect(state.unsubscribe).toBeNull();
      expect(state.activeSourceId).toBeNull();
    });

    it('should handle cleanup when no unsubscribe', () => {
      useSourceStore.setState({ unsubscribe: null });

      // Should not throw
      useSourceStore.getState().cleanup();

      expect(useSourceStore.getState().sources).toEqual([]);
    });
  });
});
