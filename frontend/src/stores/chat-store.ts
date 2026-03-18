import { create } from "zustand";
import type { ChatMessage, Citation } from "@/types/api";
import { api } from "@/services/api";

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  isLoading: boolean;
  abortStream: (() => void) | null;

  fetchHistory: (notebookId: string) => Promise<void>;
  sendMessage: (notebookId: string, message: string, sourceIds: string[], webSearch?: boolean) => Promise<void>;
  stopStream: () => void;
  clearHistory: (notebookId: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  isLoading: false,
  abortStream: null,

  fetchHistory: async (notebookId: string) => {
    set({ isLoading: true });
    try {
      const messages = await api.getChatHistory(notebookId);
      set({ messages });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async (notebookId: string, message: string, sourceIds: string[], webSearch: boolean = false) => {
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
      abortStream: null,
    }));

    let retried = false;

    const startStream = async () => {
      const { abort, promise } = api.sendChatMessage(
        notebookId,
        message,
        sourceIds,
        // onToken
        (token: string) => {
          set(state => ({
            streamingContent: state.streamingContent + token,
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
        // onError — auto-retry once on network failure
        (error: string) => {
          if (!retried && (error.includes("Failed to fetch") || error.includes("network"))) {
            retried = true;
            set({ streamingContent: "" });
            setTimeout(() => startStream(), 1000);
            return;
          }
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
        webSearch,
      );

      set({ abortStream: abort });
      await promise;
    };

    await startStream();
  },

  stopStream: () => {
    const { abortStream, streamingContent } = get();
    if (abortStream) {
      abortStream();
    }

    // Finalize whatever has been streamed so far as a message
    if (streamingContent) {
      // Strip citation markers [1][2] since we don't have citation data when stopped early
      const cleanedContent = streamingContent.replace(/\s*\[\d+\]/g, "");

      const assistantMsg: ChatMessage = {
        id: `stopped-${Date.now()}`,
        notebook_id: "",
        user_id: "",
        role: "assistant",
        content: cleanedContent,
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
    set({ messages: [], isStreaming: false, streamingContent: "", isLoading: false, abortStream: null });
  },
}));
