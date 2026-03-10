import type { TokenResponse, User, Notebook, Source, ChatMessage, Citation, SavedNote, InviteLink, Member } from "@/types/api";

const API_BASE = "/api";

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

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed: ${res.status}`);
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

  // Notebooks
  async listNotebooks(): Promise<Notebook[]> {
    return this.request("/notebooks");
  }

  async createNotebook(data: { name: string; emoji?: string; cover_color?: string; is_team?: boolean }): Promise<Notebook> {
    return this.request("/notebooks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getNotebook(id: string): Promise<Notebook> {
    return this.request(`/notebooks/${id}`);
  }

  async updateNotebook(id: string, data: { name?: string; emoji?: string; cover_color?: string }): Promise<Notebook> {
    return this.request(`/notebooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteNotebook(id: string): Promise<void> {
    await this.request(`/notebooks/${id}`, { method: "DELETE" });
  }

  // Sources
  async uploadSource(notebookId: string, file: File): Promise<Source> {
    const formData = new FormData();
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${API_BASE}/notebooks/${notebookId}/sources`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Upload failed: ${res.status}`);
    }

    return res.json();
  }

  async listSources(notebookId: string): Promise<Source[]> {
    return this.request(`/notebooks/${notebookId}/sources`);
  }

  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/sources/${sourceId}`, { method: "DELETE" });
  }

  subscribeToSourceStatus(
    notebookId: string,
    onEvent: (event: { type: string; source_id: string; status: string; error?: string }) => void,
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
  async sendChatMessage(
    notebookId: string,
    message: string,
    sourceIds: string[],
    onToken: (token: string) => void,
    onDone: (data: { id: string; citations: Citation[] }) => void,
    onError: (error: string) => void,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${API_BASE}/notebooks/${notebookId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, source_ids: sourceIds.length > 0 ? sourceIds : null }),
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
              if (data.type === "token") {
                onToken(data.content);
              } else if (data.type === "done") {
                onDone({ id: data.id, citations: data.citations || [] });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Chat request failed");
    }
  }

  async getChatHistory(notebookId: string): Promise<ChatMessage[]> {
    return this.request(`/notebooks/${notebookId}/chat/history`);
  }

  async clearChatHistory(notebookId: string): Promise<void> {
    await this.request(`/notebooks/${notebookId}/chat/history`, { method: "DELETE" });
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
  async createInviteLink(notebookId: string, role: string): Promise<InviteLink> {
    return this.request(`/notebooks/${notebookId}/share`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  }

  async sendEmailInvite(notebookId: string, email: string, role: string): Promise<{ message: string }> {
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
  async generateStudioContent(notebookId: string, contentType: string): Promise<string> {
    const data = await this.request<{ content: string }>(`/notebooks/${notebookId}/studio/${contentType}`, {
      method: "POST",
    });
    return data.content;
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

  async downloadPPT(notebookId: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE}/notebooks/${notebookId}/studio/ppt`, {
      method: "POST",
      headers,
      credentials: "include",
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error((err as { detail?: string }).detail || "PPT generation failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      response.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ||
      "presentation.pptx";
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const api = new ApiClient();
