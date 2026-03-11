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

  setThinking: (value: boolean) => void;
  fetchHistory: (notebookId: string) => Promise<void>;
  sendMessage: (notebookId: string, message: string, sourceIds: string[], thinking?: boolean) => Promise<void>;
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
    }));

    await api.sendChatMessage(
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
  },

  clearHistory: async (notebookId: string) => {
    await api.clearChatHistory(notebookId);
    set({ messages: [] });
  },

  reset: () => {
    set({ messages: [], isStreaming: false, streamingContent: "", isLoading: false, reasoningContent: "", isThinkingPhase: false });
  },
}));
