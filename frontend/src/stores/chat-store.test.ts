import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from './chat-store';
import { api } from '@/services/api';
import type { ChatMessage } from '@/types/api';

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  notebook_id: 'nb-1',
  user_id: 'user-1',
  role: 'user',
  content: 'Hello',
  citations: [],
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    streamingContent: '',
    isLoading: false,
    abortStream: null,
  });
  vi.restoreAllMocks();
});

describe('useChatStore', () => {
  describe('initial state', () => {
    it('should start empty and not streaming', () => {
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.isLoading).toBe(false);
      expect(state.abortStream).toBeNull();
    });
  });

  describe('fetchHistory', () => {
    it('should fetch and set messages', async () => {
      const messages = [makeMessage(), makeMessage({ id: 'msg-2', role: 'assistant' })];
      vi.spyOn(api, 'getChatHistory').mockResolvedValueOnce(messages);

      await useChatStore.getState().fetchHistory('nb-1');

      const state = useChatStore.getState();
      expect(state.messages).toEqual(messages);
      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading during fetch', async () => {
      let resolve: (v: ChatMessage[]) => void;
      vi.spyOn(api, 'getChatHistory').mockReturnValue(
        new Promise((r) => { resolve = r; })
      );

      const p = useChatStore.getState().fetchHistory('nb-1');
      expect(useChatStore.getState().isLoading).toBe(true);

      resolve!([]);
      await p;
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('should set isLoading false even on error', async () => {
      vi.spyOn(api, 'getChatHistory').mockRejectedValueOnce(new Error('fail'));

      await useChatStore.getState().fetchHistory('nb-1').catch(() => {});

      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should add optimistic user message and set streaming state', async () => {
      vi.spyOn(api, 'sendChatMessage').mockImplementation(
        (_nbId, _msg, _srcIds, _onToken, onDone) => {
          // Immediately call onDone
          onDone({ id: 'resp-1', citations: [] });
          return { promise: Promise.resolve(), abort: vi.fn() };
        }
      );

      await useChatStore.getState().sendMessage('nb-1', 'Hello', []);

      const state = useChatStore.getState();
      // Should have user message + assistant message
      expect(state.messages.length).toBeGreaterThanOrEqual(1);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[0].content).toBe('Hello');
    });

    it('should handle token streaming', async () => {
      vi.spyOn(api, 'sendChatMessage').mockImplementation(
        (_nbId, _msg, _srcIds, onToken, onDone) => {
          onToken('Hello ');
          onToken('World');
          onDone({ id: 'resp-1', citations: [] });
          return { promise: Promise.resolve(), abort: vi.fn() };
        }
      );

      await useChatStore.getState().sendMessage('nb-1', 'test', []);

      const state = useChatStore.getState();
      const assistantMsg = state.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('Hello World');
    });

    it('should handle error response', async () => {
      vi.spyOn(api, 'sendChatMessage').mockImplementation(
        (_nbId, _msg, _srcIds, _onToken, _onDone, onError) => {
          onError('Something went wrong');
          return { promise: Promise.resolve(), abort: vi.fn() };
        }
      );

      await useChatStore.getState().sendMessage('nb-1', 'test', []);

      const state = useChatStore.getState();
      const errorMsg = state.messages.find((m) => m.content.includes('Error:'));
      expect(errorMsg).toBeDefined();
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('stopStream', () => {
    it('should call abort and finalize streamed content as message', () => {
      const abortFn = vi.fn();
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'Partial response',
        abortStream: abortFn,
      });

      useChatStore.getState().stopStream();

      expect(abortFn).toHaveBeenCalled();
      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe('');
      const msg = state.messages.find((m) => m.content === 'Partial response');
      expect(msg).toBeDefined();
      expect(msg?.role).toBe('assistant');
    });

    it('should strip citation markers from stopped content', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'The market is growing [1] rapidly [2][3] in Asia',
        abortStream: vi.fn(),
      });

      useChatStore.getState().stopStream();

      const state = useChatStore.getState();
      const msg = state.messages[state.messages.length - 1];
      expect(msg.content).toBe('The market is growing rapidly in Asia');
      expect(msg.citations).toEqual([]);
    });

    it('should handle stop when no streaming content', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: '',
        abortStream: vi.fn(),
      });

      useChatStore.getState().stopStream();

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages).toEqual([]);
    });

    it('should handle stop when no abort function', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'content',
        abortStream: null,
      });

      useChatStore.getState().stopStream();

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('clearHistory', () => {
    it('should clear messages after API call', async () => {
      useChatStore.setState({ messages: [makeMessage()] });
      vi.spyOn(api, 'clearChatHistory').mockResolvedValueOnce(undefined);

      await useChatStore.getState().clearHistory('nb-1');

      expect(useChatStore.getState().messages).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset all state and call abort if streaming', () => {
      const abortFn = vi.fn();
      useChatStore.setState({
        messages: [makeMessage()],
        isStreaming: true,
        streamingContent: 'partial',
        isLoading: true,
        abortStream: abortFn,
      });

      useChatStore.getState().reset();

      expect(abortFn).toHaveBeenCalled();
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.isLoading).toBe(false);
      expect(state.abortStream).toBeNull();
    });
  });
});
