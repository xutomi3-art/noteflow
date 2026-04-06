import type { TokenResponse, User, Notebook, Source, ChatMessage, Citation, SavedNote, InviteLink, Member, CustomSkill, Session } from "@/types/api";
import type { DashboardStats, UserListResponse, SystemSettingItem, ServiceHealth, ResourcesData, UsageStats, ChatLogItem, FeedbackItem } from "@/types/admin";

const API_BASE = "/api";

/** Error subclass that carries the HTTP status code so callers can branch on it. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

class ApiClient {
  private accessToken: string | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
  }

  getToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // Auto-refresh on 401 (token expired)
    if (res.status === 401 && this.accessToken && !path.includes("/auth/")) {
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const tokens = await this.refreshToken(refreshToken);
          this.accessToken = tokens.access_token;
          localStorage.setItem("access_token", tokens.access_token);
          localStorage.setItem("refresh_token", tokens.refresh_token);
          // Retry original request with new token
          headers["Authorization"] = `Bearer ${tokens.access_token}`;
          const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
          if (retryRes.ok) return retryRes.json();
        } catch {
          // Refresh failed — redirect to login
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
          throw new ApiError("Session expired", 401);
        }
      }
      // No refresh token — redirect to login
      localStorage.removeItem("access_token");
      window.location.href = "/login";
      throw new ApiError("Session expired", 401);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.detail;
      const message = Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ')
        : detail || `Request failed: ${res.status}`;
      throw new ApiError(message, res.status);
    }

    return res.json();
  }

  // Auth
  async register(email: string, name: string, password: string): Promise<TokenResponse> {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    });
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    return this.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }

  async getMe(): Promise<User> {
    return this.request("/auth/me");
  }

  async forgotPassword(email: string): Promise<void> {
    await this.request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, new_password: string): Promise<void> {
    await this.request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password }),
    });
  }

  // Notebooks
  async listNotebooks(): Promise<Notebook[]> {
    return this.request("/notebooks");
  }

  async createNotebook(data: { name: string; emoji?: string; cover_color?: string; is_team?: boolean; custom_prompt?: string }): Promise<Notebook> {
    return this.request("/notebooks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getNotebook(id: string): Promise<Notebook> {
    return this.request(`/notebooks/${id}`);
  }

  async updateNotebook(id: string, data: { name?: string; emoji?: string; cover_color?: string; custom_prompt?: string; suggestion_level?: string }): Promise<Notebook> {
    return this.request(`/notebooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async optimizePrompt(prompt: string): Promise<string> {
    const res = await this.request<{ optimized_prompt: string }>("/notebooks/optimize-prompt", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    return res.optimized_prompt;
  }

  async deleteNotebook(id: string): Promise<void> {
    await this.request(`/notebooks/${id}`, { method: "DELETE" });
  }

  // Sources
  uploadSource(
    notebookId: string,
    file: File,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<Source> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      if (signal) {
        signal.addEventListener("abort", () => xhr.abort());
      }

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("Invalid response")); }
        } else {
          try {
            const body = JSON.parse(xhr.responseText);
            reject(new Error(body.detail || `Upload failed: ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.addEventListener("abort", () => {
        const err = new DOMException("Upload aborted", "AbortError");
        reject(err);
      });

      xhr.open("POST", `${API_BASE}/notebooks/${notebookId}/sources`);
      if (this.accessToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${this.accessToken}`);
      }
      xhr.send(formData);
    });
  }

  async listSources(notebookId: string): Promise<Source[]> {
    return this.request(`/notebooks/${notebookId}/sources`);
  }

  async addUrlSource(notebookId: string, url: string): Promise<Source> {
    return this.request(`/notebooks/${notebookId}/sources/url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/sources/${sourceId}`, { method: "DELETE" });
  }

  async toggleSharedChat(notebookId: string, enabled: boolean): Promise<void> {
    await this.request(`/notebooks/${notebookId}/shared-chat`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  }

  async renameSource(notebookId: string, sourceId: string, filename: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/sources/${sourceId}/rename`, {
      method: "PATCH",
      body: JSON.stringify({ filename }),
    });
  }

  async getSourceContent(notebookId: string, sourceId: string): Promise<{ content: string | null; filename?: string; file_type?: string; message?: string }> {
    return this.request(`/notebooks/${notebookId}/sources/${sourceId}/content`);
  }

  subscribeToSourceStatus(
    notebookId: string,
    onEvent: (event: { type: string; source_id: string; status: string; error?: string; progress?: number }) => void,
  ): () => void {
    const token = this.accessToken;
    const url = `${API_BASE}/notebooks/${notebookId}/sources/status`;

    const controller = new AbortController();

    const connect = async () => {
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent(data);
              } catch {
                /* ignore parse errors */
              }
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          // Reconnect after 3 seconds on error
          setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => controller.abort();
  }

  // Chat
  sendChatMessage(
    notebookId: string,
    message: string,
    sourceIds: string[],
    onToken: (token: string) => void,
    onDone: (data: { id: string; citations: Citation[] }) => void,
    onError: (error: string) => void,
    webSearch: boolean = false,
    deepThinking: boolean = false,
    sessionId?: string,
    onSessionRenamed?: (sessionId: string, name: string) => void,
  ): { promise: Promise<void>; abort: () => void } {
    const controller = new AbortController();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const promise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/notebooks/${notebookId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, source_ids: sourceIds.length > 0 ? sourceIds : null, ...(webSearch ? { web_search: true } : {}), ...(deepThinking ? { deep_thinking: true } : {}), ...(sessionId ? { session_id: sessionId } : {}) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        onError(body.detail || `Chat failed: ${response.status}`);
        return;
      }

      if (!response.body) {
        onError("No response body");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedFirstToken = false;
      const STREAM_TIMEOUT_MS = 180_000; // 180s without any token → timeout
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;

      // Single timeout — fires once if no token arrives within 180s
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          timedOut = true;
          onError("LLM response timed out — the AI service may be slow. Please try again.");
          controller.abort();
        }, STREAM_TIMEOUT_MS);
      };
      resetTimeout();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!receivedFirstToken && !timedOut) {
            onError("Connection closed without response — the AI service may be slow. Please try again.");
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "token") {
                resetTimeout(); // got a token — reset the 180s timer
                receivedFirstToken = true;
                onToken(data.content);
              } else if (data.type === "done") {
                if (timeoutId) clearTimeout(timeoutId);
                onDone({ id: data.id, citations: data.citations || [] });
              } else if (data.type === "error") {
                if (timeoutId) clearTimeout(timeoutId);
                onError(data.message);
                return;
              } else if (data.type === "session_renamed") {
                if (onSessionRenamed) onSessionRenamed(data.session_id, data.name);
              } else if (data.type === "thinking" || data.type === "searching" || data.type === "observation") {
                resetTimeout(); // thinking/searching counts as activity
                onToken(`__REACT__${JSON.stringify(data)}__REACT__`);
              }
            } catch { /* ignore parse errors */ }
          } else if (line.startsWith(": keepalive")) {
            // Keepalive keeps SSE alive but does NOT reset token timeout
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Stream was intentionally aborted — not an error
        return;
      }
      onError(e instanceof Error ? e.message : "Chat request failed");
    }
    })();

    return { promise, abort: () => controller.abort() };
  }

  async getChatHistory(notebookId: string, sessionId?: string): Promise<ChatMessage[]> {
    const params = sessionId ? `?session_id=${sessionId}` : "";
    return this.request(`/notebooks/${notebookId}/chat/history${params}`);
  }

  async clearChatHistory(notebookId: string, sessionId?: string): Promise<void> {
    const params = sessionId ? `?session_id=${sessionId}` : "";
    await this.request(`/notebooks/${notebookId}/chat/history${params}`, { method: "DELETE" });
  }

  // Chat models (public, for Just Chat)
  async getChatModels(notebookId: string): Promise<Array<{ id: string; name: string; provider: string }>> {
    return this.request(`/notebooks/${notebookId}/chat/models`);
  }

  // Sessions
  async getSessions(notebookId: string): Promise<Session[]> {
    const res = await this.request<{ data: Session[] }>(`/notebooks/${notebookId}/sessions`);
    return (res as any).data ?? res;
  }

  async createSession(notebookId: string, name: string = "New Session"): Promise<Session> {
    const res = await this.request<{ data: Session }>(`/notebooks/${notebookId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return (res as any).data ?? res;
  }

  async renameSession(notebookId: string, sessionId: string, name: string): Promise<Session> {
    const res = await this.request<{ data: Session }>(`/notebooks/${notebookId}/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    return (res as any).data ?? res;
  }

  async deleteSession(notebookId: string, sessionId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/sessions/${sessionId}`, { method: "DELETE" });
  }

  async submitChatFeedback(notebookId: string, messageId: string, vote: string, comment?: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/chat/feedback`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId, vote, comment }),
    });
  }

  // Multi-model chat (Just Chat) — non-streaming fallback
  async sendMultiChat(notebookId: string, message: string, options?: {
    sessionId?: string;
    webSearch?: boolean;
    modelIds?: string[];
    attachments?: Array<{ name: string; type: string; data: string }>;
    sourceIds?: string[];
  }): Promise<{ user_message_id: string; responses: Array<{ model_name: string; model_id: string; content: string | null; error: string | null }>; session_name?: string }> {
    return this.request(`/notebooks/${notebookId}/chat/multi`, {
      method: "POST",
      body: JSON.stringify({
        message,
        session_id: options?.sessionId,
        web_search: options?.webSearch,
        model_ids: options?.modelIds,
        attachments: options?.attachments,
        source_ids: options?.sourceIds,
      }),
    });
  }

  // Multi-model chat streaming (Just Chat SSE)
  sendMultiChatStream(
    notebookId: string,
    message: string,
    options: {
      sessionId?: string;
      webSearch?: boolean;
      modelIds?: string[];
      attachments?: Array<{ name: string; type: string; data: string }>;
      sourceIds?: string[];
    },
    callbacks: {
      onToken: (modelId: string, token: string) => void;
      onModelDone: (modelId: string) => void;
      onModelError: (modelId: string, error: string) => void;
      onSessionName: (name: string) => void;
      onAllDone: () => void;
    },
  ): { abort: () => void } {
    const controller = new AbortController();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    (async () => {
      try {
        const response = await fetch(`${API_BASE}/notebooks/${notebookId}/chat/multi/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            message,
            session_id: options.sessionId,
            web_search: options.webSearch,
            model_ids: options.modelIds,
            attachments: options.attachments,
            source_ids: options.sourceIds,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          for (const mid of options.modelIds || []) {
            callbacks.onModelError(mid, body.detail || `Stream failed: ${response.status}`);
          }
          callbacks.onAllDone();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") {
              callbacks.onAllDone();
              return;
            }
            try {
              const event = JSON.parse(data);
              if (event.type === "token") {
                callbacks.onToken(event.model_id, event.content);
              } else if (event.type === "done") {
                callbacks.onModelDone(event.model_id);
              } else if (event.type === "error") {
                callbacks.onModelError(event.model_id, event.error);
              } else if (event.type === "session_name") {
                callbacks.onSessionName(event.name);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        callbacks.onAllDone();
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") {
          for (const mid of options.modelIds || []) {
            callbacks.onModelError(mid, String(e));
          }
          callbacks.onAllDone();
        }
      }
    })();

    return { abort: () => controller.abort() };
  }

  // Admin: LLM models
  async getLlmModels(): Promise<Array<{ id: string; name: string; provider: string; model_id: string; base_url: string; api_key: string; supports_search: boolean; search_type: string; enabled: boolean; sort_order: number }>> {
    return this.request("/admin/llm-models");
  }

  async createLlmModel(data: { name: string; provider: string; model_id: string; base_url: string; api_key: string; supports_search?: boolean; search_type?: string; enabled?: boolean; sort_order?: number }): Promise<any> {
    return this.request("/admin/llm-models", { method: "POST", body: JSON.stringify(data) });
  }

  async updateLlmModel(id: string, data: Record<string, any>): Promise<any> {
    return this.request(`/admin/llm-models/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  }

  async deleteLlmModel(id: string): Promise<void> {
    await this.request(`/admin/llm-models/${id}`, { method: "DELETE" });
  }

  // Saved Notes
  async saveNote(notebookId: string, content: string, sourceMessageId?: string): Promise<SavedNote> {
    return this.request(`/notebooks/${notebookId}/notes`, {
      method: "POST",
      body: JSON.stringify({ content, source_message_id: sourceMessageId }),
    });
  }

  async listNotes(notebookId: string): Promise<SavedNote[]> {
    return this.request(`/notebooks/${notebookId}/notes`);
  }

  async deleteNote(notebookId: string, noteId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/notes/${noteId}`, { method: "DELETE" });
  }

  // Sharing
  async createInviteLink(notebookId: string, role: string, email?: string): Promise<InviteLink> {
    return this.request(`/notebooks/${notebookId}/share`, {
      method: "POST",
      body: JSON.stringify({ role, email: email || null }),
    });
  }

  async sendEmailInvite(notebookId: string, email: string, role: string): Promise<{ message: string; join_url?: string }> {
    return this.request(`/notebooks/${notebookId}/share/email`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  }

  async stopSharing(notebookId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/share`, { method: "DELETE" });
  }

  async getMembers(notebookId: string): Promise<Member[]> {
    return this.request(`/notebooks/${notebookId}/members`);
  }

  async updateMemberRole(notebookId: string, userId: string, role: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  async removeMember(notebookId: string, userId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/members/${userId}`, { method: "DELETE" });
  }

  async leaveNotebook(notebookId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/leave`, { method: "POST" });
  }

  async transferOwnership(notebookId: string, newOwnerId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/owner`, {
      method: "PATCH",
      body: JSON.stringify({ new_owner_id: newOwnerId }),
    });
  }

  async joinViaToken(token: string): Promise<{ notebook_id: string; name: string; already_member: boolean }> {
    const resp = await this.request<{ data: { notebook_id: string; name: string; already_member: boolean } }>(`/join/${token}`, {
      method: "POST",
    });
    return resp.data;
  }

  // Overview
  async getOverview(notebookId: string): Promise<{ overview: string; suggested_questions: string[] }> {
    return this.request(`/notebooks/${notebookId}/overview`);
  }

  // Studio generation
  async generateStudioContent(notebookId: string, contentType: string, sourceIds?: string[], sessionId?: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const data = await this.request<{ content: string }>(`/notebooks/${notebookId}/studio/${contentType}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: sourceIds?.length ? sourceIds : null, ...(sessionId ? { session_id: sessionId } : {}) }),
      });
      return data.content;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Custom Skills
  async listCustomSkills(notebookId: string): Promise<CustomSkill[]> {
    return this.request(`/notebooks/${notebookId}/studio/custom-skills`);
  }

  async createCustomSkill(notebookId: string, data: { name: string; prompt: string; icon?: string; all_notebooks?: boolean; shared_with_team?: boolean }): Promise<CustomSkill> {
    return this.request(`/notebooks/${notebookId}/studio/custom-skills`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCustomSkill(notebookId: string, skillId: string, data: { name?: string; prompt?: string; all_notebooks?: boolean; shared_with_team?: boolean }): Promise<void> {
    await this.request(`/notebooks/${notebookId}/studio/custom-skills/${skillId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteCustomSkill(notebookId: string, skillId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/studio/custom-skills/${skillId}`, { method: "DELETE" });
  }

  async executeCustomSkill(notebookId: string, skillId: string, sourceIds?: string[], sessionId?: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const data = await this.request<{ content: string }>(`/notebooks/${notebookId}/studio/custom-skills/${skillId}/execute`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ source_ids: sourceIds?.length ? sourceIds : null, ...(sessionId ? { session_id: sessionId } : {}) }),
      });
      return data.content;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generatePodcast(notebookId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/notebooks/${notebookId}/studio/podcast`, {
      method: 'POST',
      credentials: 'include',
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error((err as { detail?: string }).detail || 'Podcast generation failed');
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async listPptTemplates(page: number = 1, size: number = 20, lang: string = ""): Promise<{
    records: { id: string; coverUrl: string; name?: string }[];
    total: number;
    pages: number;
  }> {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (lang) params.set("lang", lang);
    return this.request(`/ppt/templates?${params}`);
  }

  async getPptGenerationOptions(): Promise<{
    lang?: { label: string; value: string }[];
    scene?: { label: string; value: string }[];
    audience?: { label: string; value: string }[];
  }> {
    return this.request("/ppt/generation-options");
  }

  async downloadPPT(notebookId: string, config?: {
    template_id?: string;
    scene?: string;
    audience?: string;
    language?: string;
    length?: string;
    source_ids?: string[];
  }): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    if (config) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_BASE}/notebooks/${notebookId}/studio/ppt`, {
      method: "POST",
      headers,
      credentials: "include",
      body: config ? JSON.stringify(config) : undefined,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error((err as { detail?: string }).detail || "PPT generation failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const cd = response.headers.get("content-disposition") || "";
    const filenameMatch =
      cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ||
      cd.match(/filename="(.+)"/)?.[1];
    const filename = filenameMatch
      ? decodeURIComponent(filenameMatch)
      : "presentation.pptx";
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Delay revoke to let the browser start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Admin
  async getAdminDashboard(): Promise<DashboardStats> {
    return this.request("/admin/dashboard");
  }

  async getAdminUsers(params?: { search?: string; page?: number; limit?: number }): Promise<UserListResponse> {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request(`/admin/users${qs ? `?${qs}` : ""}`);
  }

  async updateAdminUser(userId: string, updates: { is_disabled?: boolean; is_admin?: boolean; name?: string }): Promise<unknown> {
    return this.request(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async batchDeleteUsers(userIds: string[]): Promise<{ deleted: number }> {
    return this.request("/admin/users/batch-delete", {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    });
  }

  async getAdminSettings(): Promise<SystemSettingItem[]> {
    return this.request("/admin/settings");
  }

  async updateAdminSettings(settings: Record<string, string>): Promise<unknown> {
    return this.request("/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    });
  }

  async getAdminHealth(): Promise<Record<string, ServiceHealth>> {
    return this.request("/admin/health");
  }

  async getAdminResources(): Promise<ResourcesData> {
    return this.request("/admin/resources");
  }

  async getAdminUsage(period: number = 7): Promise<UsageStats> {
    return this.request(`/admin/usage?period=${period}`);
  }

  async getAdminLogs(params: { page?: number; limit?: number; status?: string }): Promise<{
    items: ChatLogItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    return this.request(`/admin/logs?${searchParams}`);
  }

  // RAGFlow Internal Models
  async getRagflowModels(): Promise<Record<string, string>> {
    return this.request("/admin/ragflow-models");
  }

  async updateRagflowModels(models: Record<string, string>): Promise<Record<string, string>> {
    return this.request("/admin/ragflow-models", {
      method: "PUT",
      body: JSON.stringify(models),
    });
  }

  // RAGFlow Model Providers
  async getRagflowProviders(): Promise<{ llm_factory: string; model_type: string; llm_name: string; api_base: string; status: string }[]> {
    return this.request("/admin/ragflow-providers");
  }

  async updateRagflowProvider(body: { llm_factory: string; llm_name: string; api_base?: string; api_key?: string }): Promise<{ llm_factory: string; model_type: string; llm_name: string; api_base: string; status: string }[]> {
    return this.request("/admin/ragflow-providers", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  // Feedback
  async submitFeedback(type: string, content: string, screenshot?: File): Promise<{ id: string }> {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('content', content);
    if (screenshot) {
      formData.append('screenshot', screenshot);
    }

    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.detail || `Request failed: ${res.status}`, res.status);
    }

    return res.json();
  }

  // Admin Feedback
  async getAdminFeedback(params: { status?: string; type?: string; page?: number; limit?: number }): Promise<{
    items: FeedbackItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    if (params.type) searchParams.set('type', params.type);
    return this.request(`/admin/feedback?${searchParams}`);
  }

  async updateAdminFeedbackStatus(feedbackId: string): Promise<{ id: string; status: string }> {
    return this.request(`/admin/feedback/${feedbackId}`, { method: 'PATCH' });
  }
}

export const api = new ApiClient();
