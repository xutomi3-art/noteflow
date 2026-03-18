import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStudioStore } from './studio-store';
import { api } from '@/services/api';
import type { SavedNote } from '@/types/api';

const makeNote = (overrides: Partial<SavedNote> = {}): SavedNote => ({
  id: 'note-1',
  notebook_id: 'nb-1',
  source_message_id: null,
  content: 'Test note',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  useStudioStore.setState({
    activeTab: null,
    content: {},
    isGenerating: {},
    notes: [],
    isLoadingNotes: false,
    pdfViewer: null,
  });
  vi.restoreAllMocks();
});

describe('useStudioStore', () => {
  describe('initial state', () => {
    it('should start with default values', () => {
      const state = useStudioStore.getState();
      expect(state.activeTab).toBeNull();
      expect(state.content).toEqual({});
      expect(state.isGenerating).toEqual({});
      expect(state.notes).toEqual([]);
      expect(state.isLoadingNotes).toBe(false);
      expect(state.pdfViewer).toBeNull();
    });
  });

  describe('setActiveTab', () => {
    it('should set the active tab', () => {
      useStudioStore.getState().setActiveTab('summary');
      expect(useStudioStore.getState().activeTab).toBe('summary');
    });

    it('should set tab to null', () => {
      useStudioStore.setState({ activeTab: 'faq' });
      useStudioStore.getState().setActiveTab(null);
      expect(useStudioStore.getState().activeTab).toBeNull();
    });
  });

  describe('openPdf / closePdf', () => {
    it('should open PDF viewer with source info', () => {
      useStudioStore.getState().openPdf('src-1', 'doc.pdf', 5);
      const state = useStudioStore.getState();
      expect(state.pdfViewer).toEqual({
        sourceId: 'src-1',
        filename: 'doc.pdf',
        page: 5,
        _seq: 1,
      });
    });

    it('should increment _seq on subsequent opens', () => {
      useStudioStore.getState().openPdf('src-1', 'doc.pdf', 1);
      useStudioStore.getState().openPdf('src-1', 'doc.pdf', 3);
      expect(useStudioStore.getState().pdfViewer?._seq).toBe(2);
    });

    it('should close PDF viewer', () => {
      useStudioStore.getState().openPdf('src-1', 'doc.pdf', 1);
      useStudioStore.getState().closePdf();
      expect(useStudioStore.getState().pdfViewer).toBeNull();
    });
  });

  describe('clearContent', () => {
    it('should remove content for specific type', () => {
      useStudioStore.setState({ content: { summary: 'Sum', faq: 'FAQ' } });
      useStudioStore.getState().clearContent('summary');
      const state = useStudioStore.getState();
      expect(state.content.summary).toBeUndefined();
      expect(state.content.faq).toBe('FAQ');
    });
  });

  describe('generateContent', () => {
    it('should generate and store content', async () => {
      vi.spyOn(api, 'generateStudioContent').mockResolvedValueOnce('Generated summary');

      await useStudioStore.getState().generateContent('nb-1', 'summary');

      const state = useStudioStore.getState();
      expect(state.content.summary).toBe('Generated summary');
      expect(state.isGenerating.summary).toBe(false);
    });

    it('should strip json fences from mindmap content', async () => {
      vi.spyOn(api, 'generateStudioContent').mockResolvedValueOnce(
        '```json\n{"name":"root"}\n```'
      );

      await useStudioStore.getState().generateContent('nb-1', 'mindmap');

      expect(useStudioStore.getState().content.mindmap).toBe('{"name":"root"}');
    });

    it('should not strip fences from non-mindmap content', async () => {
      vi.spyOn(api, 'generateStudioContent').mockResolvedValueOnce('```code```');

      await useStudioStore.getState().generateContent('nb-1', 'summary');

      expect(useStudioStore.getState().content.summary).toBe('```code```');
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(api, 'generateStudioContent').mockRejectedValueOnce(new Error('API error'));

      await useStudioStore.getState().generateContent('nb-1', 'summary');

      const state = useStudioStore.getState();
      expect(state.content.summary).toContain('Error generating content');
      expect(state.isGenerating.summary).toBe(false);
    });

    it('should clear previous content before generating', async () => {
      useStudioStore.setState({ content: { summary: 'Old content' } });
      vi.spyOn(api, 'generateStudioContent').mockResolvedValueOnce('New content');

      await useStudioStore.getState().generateContent('nb-1', 'summary');

      expect(useStudioStore.getState().content.summary).toBe('New content');
    });
  });

  describe('fetchNotes', () => {
    it('should fetch and set notes', async () => {
      const notes = [makeNote(), makeNote({ id: 'note-2' })];
      vi.spyOn(api, 'listNotes').mockResolvedValueOnce(notes);

      await useStudioStore.getState().fetchNotes('nb-1');

      const state = useStudioStore.getState();
      expect(state.notes).toEqual(notes);
      expect(state.isLoadingNotes).toBe(false);
    });

    it('should set isLoadingNotes false on error', async () => {
      vi.spyOn(api, 'listNotes').mockRejectedValueOnce(new Error('fail'));

      await useStudioStore.getState().fetchNotes('nb-1').catch(() => {});

      expect(useStudioStore.getState().isLoadingNotes).toBe(false);
    });
  });

  describe('deleteNote', () => {
    it('should remove note from list', async () => {
      const notes = [makeNote({ id: 'note-1' }), makeNote({ id: 'note-2' })];
      useStudioStore.setState({ notes });
      vi.spyOn(api, 'deleteNote').mockResolvedValueOnce(undefined);

      await useStudioStore.getState().deleteNote('nb-1', 'note-1');

      const state = useStudioStore.getState();
      expect(state.notes).toHaveLength(1);
      expect(state.notes[0].id).toBe('note-2');
    });
  });

  describe('reset', () => {
    it('should reset all state to defaults', () => {
      useStudioStore.setState({
        activeTab: 'summary',
        content: { summary: 'text' },
        isGenerating: { summary: true },
        notes: [makeNote()],
        isLoadingNotes: true,
        pdfViewer: { sourceId: 's', filename: 'f', page: 1, _seq: 1 },
      });

      useStudioStore.getState().reset();

      const state = useStudioStore.getState();
      expect(state.activeTab).toBeNull();
      expect(state.content).toEqual({});
      expect(state.isGenerating).toEqual({});
      expect(state.notes).toEqual([]);
      expect(state.isLoadingNotes).toBe(false);
      expect(state.pdfViewer).toBeNull();
    });
  });
});
