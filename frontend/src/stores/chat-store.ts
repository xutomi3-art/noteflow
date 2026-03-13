import { create } from "zustand";
import type { ChatMessage, Citation } from "@/types/api";
import { api } from "@/services/api";

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  isLoading: boolean;
  thinking: boolean;
  reasoningContent: string;
  isThinkingPhase: boolean;
  abortStream: (() => void) | null;

  setThinking: (value: boolean) => void;
  fetchHistory: (notebookId: string) => Promise<void>;
  sendMessage: (notebookId: string, message: string, sourceIds: string[], thinking?: boolean) => Promise<void>;
  stopStream: () => void;
  clearHistory: (notebookId: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  isLoading: false,
  thinking: false,
  reasoningContent: "",
  isThinkingPhase: false,
  abortStream: null,

  setThinking: (value: boolean) => set({ thinking: value }),

  fetchHistory: async (notebookId: string) => {
    set({ isLoading: true });
    try {
      const messages = await api.getChatHistory(notebookId);
      set({ messages });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async (notebookId: string, message: string, sourceIds: string[], thinking?: boolean) => {
    // Add optimistic user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      notebook_id: notebookId,
      user_id: "",
      role: "user",
      content: message,
      citations: [],
      created_at: new Date().toISOString(),
    };

    set(state => ({
      messages: [...state.messages, tempUserMsg],
      isStreaming: true,
      streamingContent: "",
      reasoningContent: "",
      isThinkingPhase: false,
      abortStream: null,
    }));

    const { abort, promise } = api.sendChatMessage(
      notebookId,
      message,
      sourceIds,
      // onToken
      (token: string) => {
        set(state => ({
          streamingContent: state.streamingContent + token,
          isThinkingPhase: false,
        }));
      },
      // onDone
      (data: { id: string; citations: Citation[] }) => {
        const { streamingContent } = get();
        const assistantMsg: ChatMessage = {
          id: data.id,
          notebook_id: notebookId,
          user_id: "",
          role: "assistant",
          content: streamingContent,
          citations: data.citations,
          created_at: new Date().toISOString(),
        };

        set(state => ({
          messages: [...state.messages, assistantMsg],
          isStreaming: false,
          streamingContent: "",
          abortStream: null,
        }));
      },
      // onError (6th param)
      (error: string) => {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          notebook_id: notebookId,
          user_id: "",
          role: "assistant",
          content: `Error: ${error}`,
          citations: [],
          created_at: new Date().toISOString(),
        };

        set(state => ({
          messages: [...state.messages, errorMsg],
          isStreaming: false,
          streamingContent: "",
          abortStream: null,
        }));
      },
      thinking,
      // onThinkingStart
      () => {
        set({ isThinkingPhase: true });
      },
      // onReasoning
      (content: string) => {
        set(state => ({
          reasoningContent: state.reasoningContent + content,
        }));
      },
    );

    set({ abortStream: abort });
    await promise;
  },

  stopStream: () => {
    const { abortStream, streamingContent } = get();
    if (abortStream) {
      abortStream();
    }

    // Finalize whatever has been streamed so far as a message
    if (streamingContent) {
      const assistantMsg: ChatMessage = {
        id: `stopped-${Date.now()}`,
        notebook_id: "",
        user_id: "",
        role: "assistant",
        content: streamingContent,
        citations: [],
        created_at: new Date().toISOString(),
      };

      set(state => ({
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        streamingContent: "",
        abortStream: null,
      }));
    } else {
      set({ isStreaming: false, streamingContent: "", abortStream: null });
    }
  },

  clearHistory: async (notebookId: string) => {
    await api.clearChatHistory(notebookId);
    set({ messages: [] });
  },

  reset: () => {
    const { abortStream } = get();
    if (abortStream) abortStream();
    set({ messages: [], isStreaming: false, streamingContent: "", isLoading: false, reasoningContent: "", isThinkingPhase: false, abortStream: null });
  },
}));
