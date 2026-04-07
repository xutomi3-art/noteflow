import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, Loader2, Send, Grid2x2, Columns2, Square, Plus, MessageSquare, Pencil, X, Maximize2, Minimize2, Paperclip, Settings } from "lucide-react";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth-store";
import MarkdownContent from "@/components/MarkdownContent";
import type { Session, ChatMessage } from "@/types/api";

interface LlmModel { id: string; name: string; provider: string }
interface ChatMsg { role: "user" | "assistant"; content: string }
interface JustChatProps { notebookId: string; notebookName: string }
type GridMode = 1 | 2 | 4;

export default function JustChat({ notebookId, notebookName }: JustChatProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [gridMode, setGridMode] = useState<GridMode>(4);
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelChats, setModelChats] = useState<Record<string, ChatMsg[]>>({});
  const [streamingContent, setStreamingContent] = useState<Record<string, string>>({});
  const streamingRef = useRef<Record<string, string>>({});
  const abortRef = useRef<(() => void) | null>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Expanded panel
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);

  // Attachments: images stay local, documents get uploaded as sources
  const uploadIdRef = useRef(0);
  const [attachments, setAttachments] = useState<Array<{
    uploadId: number;
    name: string;
    url: string;
    file: File;
    isImage: boolean;
    sourceId?: string;
    status?: "uploading" | "parsing" | "vectorizing" | "ready" | "failed";
    progress?: number;
  }>>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getChatModels(notebookId).then((models) => {
      setAvailableModels(models);
      setSelectedModelIds(models.slice(0, 4).map((m) => m.id));
    }).catch(() => {});
  }, [notebookId]);

  // Load session messages from backend and reconstruct per-model chat history
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const messages: ChatMessage[] = await api.getChatHistory(notebookId, sessionId);
      // First pass: collect which models actually have assistant responses
      const respondedIds = new Set<string>();
      for (const msg of messages) {
        if (msg.role === "assistant" && (msg.metadata as any)?.model_id) {
          respondedIds.add((msg.metadata as any).model_id as string);
        }
      }
      // Second pass: only show user messages in panels that have responses
      const chats: Record<string, ChatMsg[]> = {};
      for (const msg of messages) {
        if (msg.role === "user") {
          for (const mid of respondedIds) {
            if (!chats[mid]) chats[mid] = [];
            chats[mid].push({ role: "user", content: msg.content });
          }
        } else if (msg.role === "assistant" && (msg.metadata as any)?.model_id) {
          const modelId = (msg.metadata as any).model_id as string;
          if (!chats[modelId]) chats[modelId] = [];
          chats[modelId].push({ role: "assistant", content: msg.content });
        }
      }
      setModelChats(chats);
    } catch {
      setModelChats({});
    }
  }, [notebookId]);

  useEffect(() => {
    api.getSessions(notebookId).then((ss) => {
      setSessions(ss);
      if (ss.length > 0) setActiveSessionId(ss[0].id);
    }).catch(() => {});
  }, [notebookId]);

  // Load session messages when models become available or active session changes
  const modelsReady = availableModels.length > 0;
  useEffect(() => {
    if (modelsReady && activeSessionId) {
      loadSessionMessages(activeSessionId);
    }
  }, [modelsReady, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Object.values(panelRefs.current).forEach((el) => { if (el) el.scrollTop = el.scrollHeight; });
  }, [modelChats, streamingContent, isLoading]);

  const activeModels = selectedModelIds.map((id) => availableModels.find((m) => m.id === id)).filter((m): m is LlmModel => !!m).slice(0, gridMode);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;

    const currentAttachments = [...attachments];
    const fileNames = currentAttachments.map((a) => a.name);
    const displayMsg = fileNames.length > 0 ? `${msg}\n\n📎 ${fileNames.join(", ")}` : msg;

    setInput("");
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);

    // Add user message to all active model panels
    setModelChats((prev) => {
      const next = { ...prev };
      for (const m of activeModels) next[m.id] = [...(next[m.id] || []), { role: "user", content: displayMsg }];
      return next;
    });

    // Reset streaming state
    const initialStreaming: Record<string, string> = {};
    for (const m of activeModels) initialStreaming[m.id] = "";
    streamingRef.current = { ...initialStreaming };
    setStreamingContent({ ...initialStreaming });

    // Images → base64, documents already uploaded as sources
    const imgAtts: Array<{ name: string; type: string; data: string }> = [];
    const docSourceIds: string[] = [];
    for (const att of currentAttachments) {
      if (att.isImage) {
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(att.file);
        });
        imgAtts.push({ name: att.name, type: att.file.type, data: b64 });
      } else if (att.sourceId) {
        docSourceIds.push(att.sourceId);
      }
    }

    const { abort } = api.sendMultiChatStream(
      notebookId,
      msg,
      {
        webSearch,
        modelIds: activeModels.map((m) => m.id),
        sessionId: activeSessionId || undefined,
        attachments: imgAtts.length > 0 ? imgAtts : undefined,
        sourceIds: docSourceIds.length > 0 ? docSourceIds : undefined,
      },
      {
        onToken: (modelId, token) => {
          streamingRef.current[modelId] = (streamingRef.current[modelId] || "") + token;
          setStreamingContent({ ...streamingRef.current });
        },
        onModelDone: (modelId) => {
          const content = streamingRef.current[modelId] || "";
          if (content) {
            setModelChats((prev) => ({
              ...prev,
              [modelId]: [...(prev[modelId] || []), { role: "assistant" as const, content }],
            }));
          }
          streamingRef.current[modelId] = "";
          setStreamingContent((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
        },
        onModelError: (modelId, error) => {
          setModelChats((prev) => ({
            ...prev,
            [modelId]: [...(prev[modelId] || []), { role: "assistant" as const, content: `Error: ${error}` }],
          }));
          streamingRef.current[modelId] = "";
          setStreamingContent((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
        },
        onSessionName: (name) => {
          if (activeSessionId) {
            setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, name } : s));
          }
        },
        onAllDone: () => {
          setIsLoading(false);
          setStreamingContent({});
          streamingRef.current = {};
          abortRef.current = null;
          setTimeout(() => inputRef.current?.focus(), 100);
        },
      },
    );
    abortRef.current = abort;
  }, [input, isLoading, notebookId, webSearch, activeModels, activeSessionId, attachments]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
  };

  const toggleModel = (id: string) => {
    setSelectedModelIds((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      const next = [...prev, id];
      return next.length > gridMode ? next.slice(next.length - gridMode) : next;
    });
  };

  useEffect(() => {
    setSelectedModelIds((prev) => prev.length > gridMode ? prev.slice(prev.length - gridMode) : prev);
  }, [gridMode]);

  const switchSession = (sid: string) => {
    if (abortRef.current) { abortRef.current(); abortRef.current = null; }
    setActiveSessionId(sid); setModelChats({}); setStreamingContent({}); streamingRef.current = {};
    setExpandedModelId(null); setIsLoading(false);
  };
  const createNewChat = async () => {
    const s = await api.createSession(notebookId, `Chat ${sessions.length + 1}`);
    setSessions((prev) => [...prev, s]);
    switchSession(s.id);
  };

  // Upload document as source and poll status — same pattern as NotebookPage
  const uploadDocAsSource = useCallback(async (file: File, uploadId: number) => {
    const match = (a: { uploadId: number }) => a.uploadId === uploadId;
    try {
      const source = await api.uploadSource(notebookId, file, undefined, (progress: number) => {
        setAttachments((prev) => prev.map((a) => match(a) ? { ...a, progress } : a));
      });
      if (!source?.id) return;
      setAttachments((prev) => prev.map((a) => match(a) ? { ...a, sourceId: source.id, status: "parsing" as const, progress: 100 } : a));
      // Poll for ready status
      const poll = setInterval(async () => {
        try {
          const sources = await api.getSources(notebookId);
          const src = sources.find((s: any) => s.id === source.id);
          if (src) {
            if (src.status === "ready") {
              clearInterval(poll);
              setAttachments((prev) => prev.map((a) => match(a) ? { ...a, status: "ready" as const } : a));
            } else if (src.status === "failed") {
              clearInterval(poll);
              setAttachments((prev) => prev.map((a) => match(a) ? { ...a, status: "failed" as const } : a));
            } else {
              setAttachments((prev) => prev.map((a) => match(a) ? { ...a, status: src.status as any, progress: src.progress ?? 0 } : a));
            }
          }
        } catch { /* ignore */ }
      }, 3000);
      setTimeout(() => clearInterval(poll), 300000);
    } catch {
      setAttachments((prev) => prev.map((a) => match(a) ? { ...a, status: "failed" as const } : a));
    }
  }, [notebookId]);

  // Paste image handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file || file.size > 5 * 1024 * 1024) { alert("Image must be under 5MB"); return; }
        const url = URL.createObjectURL(file);
        setAttachments((prev) => [...prev, { uploadId: ++uploadIdRef.current, name: file.name || `image-${Date.now()}.png`, url, file, isImage: true }]);
        return;
      }
    }
  }, []);

  // File upload handler — images stay local, docs upload immediately (same pattern as NotebookPage)
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { alert(`${file.name} exceeds 10MB limit`); continue; }
      const url = URL.createObjectURL(file);
      const isImage = file.type.startsWith("image/");
      const uid = ++uploadIdRef.current;
      setAttachments((prev) => [...prev, { uploadId: uid, name: file.name, url, file, isImage, status: isImage ? undefined : "uploading" }]);
      if (!isImage) {
        uploadDocAsSource(file, uid);
      }
    }
    e.target.value = "";
  };

  const gridCols = gridMode === 4 ? "grid-cols-2 grid-rows-2" : gridMode === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-1 grid-rows-1";

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#e5e7eb] overflow-hidden rounded-b-2xl">
      {/* Top header — full width, logo at far left */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/dashboard")} className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-600">
            <img src="/logo.png" alt="Noteflow" className="w-6 h-6 rounded-md" />
          </button>
          <span className="px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#5b8c15]/10 text-[#5b8c15] rounded -ml-1">Alpha</span>
          <span className="font-semibold text-[15px] text-slate-800">{notebookName}</span>
        </div>
        <div className="flex items-center gap-4">
          {/* LLM Settings — green style like Notebook Settings */}
          <div className="relative">
            <button onClick={() => setSettingsOpen(!settingsOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors bg-[#5b8c15] text-white hover:bg-[#4a7311]">
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">LLM Settings</span>
            </button>
            {settingsOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 p-4 z-30">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[13px] font-semibold text-slate-800">LLM Settings</h3>
                  <button onClick={() => setSettingsOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded"><X className="w-4 h-4" /></button>
                </div>
                <div className="mb-4">
                  <p className="text-[11px] font-medium text-slate-500 mb-2">Layout</p>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
                    {([1, 2, 4] as GridMode[]).map((mode) => (
                      <button key={mode} onClick={() => { setGridMode(mode); setExpandedModelId(null); }}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${gridMode === mode ? "bg-white shadow-sm text-slate-800" : "text-slate-400 hover:text-slate-600"}`}>
                        {mode === 1 ? "Single" : mode === 2 ? "Side by Side" : "2×2 Grid"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Grid-based model selector — each slot has a dropdown */}
                <div>
                  <p className="text-[11px] font-medium text-slate-500 mb-2">Models</p>
                  <div className={`grid gap-2 ${gridMode === 4 ? "grid-cols-2 grid-rows-2" : gridMode === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {Array.from({ length: gridMode }).map((_, slotIdx) => {
                      const currentModelId = selectedModelIds[slotIdx] || "";
                      const currentModel = availableModels.find(m => m.id === currentModelId);
                      // Models not used in other slots (except current)
                      const usedIds = new Set(selectedModelIds.filter((_, i) => i !== slotIdx));
                      const options = availableModels.filter(m => !usedIds.has(m.id));
                      return (
                        <div key={slotIdx} className="relative">
                          <select
                            value={currentModelId}
                            onChange={(e) => {
                              const newId = e.target.value;
                              setSelectedModelIds(prev => {
                                const next = [...prev];
                                while (next.length <= slotIdx) next.push("");
                                next[slotIdx] = newId;
                                return next.filter(Boolean);
                              });
                            }}
                            className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-[12px] font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] cursor-pointer pr-7"
                          >
                            {options.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </div>
                          <span className="absolute -top-1.5 -left-1 bg-white px-1 text-[9px] text-slate-400">#{slotIdx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="text-right hidden md:block">
            <div className="font-semibold text-sm">{user?.name || "User"}</div>
            <div className="text-xs text-slate-500">{user?.email}</div>
          </div>
          <div className="relative"
            onMouseEnter={() => { if (profileTimerRef.current) clearTimeout(profileTimerRef.current); setProfileMenuOpen(true); }}
            onMouseLeave={() => { profileTimerRef.current = setTimeout(() => setProfileMenuOpen(false), 500); }}>
            <button className="w-9 h-9 rounded-full bg-[#5b8c15] text-white flex items-center justify-center font-bold text-sm hover:bg-[#4a7311] transition-colors">
              {(user?.name || "U").charAt(0).toUpperCase()}
            </button>
            {profileMenuOpen && (
              <div className="absolute top-full right-0 pt-2 w-48 z-20">
                <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 py-2">
                  {user?.is_admin && (
                    <button onClick={() => { setProfileMenuOpen(false); navigate('/admin'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 font-medium transition-colors">
                      Admin Panel
                    </button>
                  )}
                  <button onClick={() => { setProfileMenuOpen(false); navigate('/dashboard'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    Dashboard
                  </button>
                  <button onClick={() => { useAuthStore.getState().logout(); navigate('/login'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex flex-1 min-h-0 overflow-hidden rounded-b-2xl">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-52" : "w-0"} shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden transition-all duration-300 rounded-bl-2xl`}>
        <div className="h-10 px-3 flex items-center shrink-0 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-700">Chats</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 pt-2 space-y-0.5">
          <button
            onClick={createNewChat}
            className="flex items-center justify-center gap-1.5 py-1.5 mb-1 rounded-lg border border-dashed border-slate-200 text-[13px] font-medium text-slate-600 hover:text-[#5b8c15] hover:border-[#5b8c15]/40 transition-colors shrink-0 w-full"
          >
            <Plus className="w-3 h-3" />
            New Chat
          </button>
          {sessions.map((s) => (
            <div key={s.id}
              className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-[12px] ${activeSessionId === s.id ? "bg-[#5b8c15]/10 text-[#5b8c15] font-medium" : "text-slate-600 hover:bg-slate-50"}`}
              onClick={() => switchSession(s.id)}>
              <MessageSquare className="w-3 h-3 shrink-0 opacity-60" />
              {renamingId === s.id ? (
                <input autoFocus className="flex-1 min-w-0 bg-white border border-slate-200 rounded px-1 py-0 text-[12px] outline-none focus:border-[#5b8c15]"
                  value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => { if (renameValue.trim()) { api.renameSession(notebookId, s.id, renameValue.trim()).then(u => setSessions(p => p.map(x => x.id === s.id ? u : x))); } setRenamingId(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { api.renameSession(notebookId, s.id, renameValue.trim()).then(u => setSessions(p => p.map(x => x.id === s.id ? u : x))); setRenamingId(null); } if (e.key === "Escape") setRenamingId(null); }}
                  onClick={(e) => e.stopPropagation()} />
              ) : <span className="flex-1 truncate">{s.name}</span>}
              {renamingId !== s.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button className="p-0.5 rounded hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.name); }}><Pencil className="w-2.5 h-2.5 text-slate-400" /></button>
                  {sessions.length > 1 && <button className="p-0.5 rounded hover:bg-red-50" onClick={(e) => { e.stopPropagation(); api.deleteSession(notebookId, s.id).then(() => { const r = sessions.filter(x => x.id !== s.id); setSessions(r); if (activeSessionId === s.id) switchSession(r[0].id); }); }}><X className="w-2.5 h-2.5 text-slate-400" /></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Panels */}
        <div className={`flex-1 min-h-0 relative ${expandedModelId ? "" : `grid ${gridCols}`} gap-px bg-slate-100 overflow-hidden`}>
          {activeModels.map((model) => {
            const messages = modelChats[model.id] || [];
            const streaming = streamingContent[model.id];
            const isStreaming = streaming !== undefined && streaming !== "";
            const isWaiting = isLoading && !isStreaming && streaming === "";
            const isExpanded = expandedModelId === model.id;
            const isHidden = !!expandedModelId && !isExpanded;
            return (
              <div key={model.id}
                className={`flex flex-col bg-white overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "absolute inset-0 z-10 m-2 rounded-2xl shadow-2xl border border-slate-200" : ""} ${isHidden ? "opacity-0 scale-95 pointer-events-none" : ""}`}
                style={isExpanded ? { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, margin: "8px", zIndex: 20 } : undefined}>
                <div className="h-10 px-3 flex items-center justify-between border-b border-slate-100 shrink-0 bg-slate-50/80">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isStreaming ? "bg-green-400 animate-pulse" : "bg-indigo-400"}`} />
                    <span className="text-[12px] font-semibold text-slate-600">{model.name}</span>
                  </div>
                  <button onClick={() => setExpandedModelId(isExpanded ? null : model.id)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                    {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div ref={(el) => { panelRefs.current[model.id] = el; }} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {messages.length === 0 && !isLoading && !isStreaming && (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-indigo-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-500">{model.name}</p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
                      {msg.role === "user" ? (
                        <div className="max-w-[85%] bg-[#5b8c15] text-white px-3 py-1.5 rounded-xl rounded-br-sm text-[13px]">{msg.content}</div>
                      ) : (
                        <div className={`text-[13px] text-slate-700 prose prose-sm max-w-none ${isExpanded ? "prose-base" : ""}`}>
                          <MarkdownContent content={msg.content} />
                        </div>
                      )}
                    </div>
                  ))}
                  {isStreaming && (
                    <div className={`text-[13px] text-slate-700 prose prose-sm max-w-none ${isExpanded ? "prose-base" : ""}`}>
                      <MarkdownContent content={streaming} />
                    </div>
                  )}
                  {isWaiting && messages.length > 0 && messages[messages.length - 1].role === "user" && (
                    <div className="flex items-center gap-1.5 py-1">
                      <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />
                      <span className="text-[11px] text-slate-400">Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 relative z-30 rounded-br-2xl" onPaste={handlePaste}>
          {/* Attachment preview */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 max-w-4xl mx-auto flex-wrap">
              {attachments.map((a, i) => {
                const ext = a.name.split('.').pop()?.toUpperCase() || '';
                const isImg = a.isImage;
                const statusColor = a.status === "ready" ? "border-green-200 bg-green-50" :
                  a.status === "failed" ? "border-red-200 bg-red-50" :
                  a.status ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50";
                const progress = a.progress ?? 0;
                return (
                <div key={i} className="relative group">
                  {isImg ? (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white pr-2 max-w-[200px]">
                      <img src={a.url} alt={a.name} className="w-10 h-10 rounded-l-lg object-cover shrink-0" />
                      <span className="text-[12px] text-slate-700 truncate">{a.name}</span>
                    </div>
                  ) : (
                    <div className={`relative overflow-hidden rounded-lg border ${statusColor} w-[200px]`}>
                      {/* Progress bar fill */}
                      {a.status && a.status !== "ready" && a.status !== "failed" && (
                        <div className="absolute inset-y-0 left-0 bg-green-100/60 transition-all duration-300" style={{ width: `${progress}%` }} />
                      )}
                      <div className="relative flex items-center gap-2 px-2.5 py-1.5">
                        <div className={`shrink-0 ${a.status === "failed" ? "text-red-400" : a.status === "ready" ? "text-green-500" : "text-slate-400"}`}>
                          {a.status && a.status !== "ready" && a.status !== "failed" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                          ) : a.status === "failed" ? (
                            <X className="w-3.5 h-3.5" />
                          ) : (
                            <Paperclip className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-slate-700 truncate">{a.name}</p>
                          {a.status && a.status !== "ready" && a.status !== "failed" && (
                            <p className="text-[10px] text-amber-600 font-medium">{a.status} {progress > 0 ? `${progress}%` : ''}</p>
                          )}
                          {a.status === "failed" && (
                            <p className="text-[10px] text-red-500">Failed</p>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-400 font-medium shrink-0">{ext}</span>
                      </div>
                    </div>
                  )}
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-500 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">×</button>
                </div>
                );
              })}
            </div>
          )}
          <div className="max-w-4xl mx-auto flex items-end gap-2">
            <div className="flex-1 border border-slate-200 rounded-2xl px-4 py-3 focus-within:border-[#5b8c15] focus-within:ring-2 focus-within:ring-[#5b8c15]/20 transition-all bg-slate-50/50">
              <textarea ref={inputRef} value={input}
                onChange={(e) => { setInput(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 192) + "px"; }}
                onKeyDown={handleKeyDown} placeholder="Ask anything..." rows={1}
                className="w-full text-[14px] text-slate-700 outline-none bg-transparent resize-none placeholder:text-slate-400 leading-relaxed"
                style={{ minHeight: "36px", maxHeight: "192px" }} />
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-3">
                  <button onClick={() => setWebSearch(!webSearch)}
                    className={`flex items-center gap-1.5 text-[11px] transition-colors ${webSearch ? "text-blue-500" : "text-slate-400"}`}>
                    <Globe className="w-3.5 h-3.5" />
                    <span>{webSearch ? "Search on" : "Search off"}</span>
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Attach</span>
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp3,.wav,.m4a,.flac,.ogg,.webm" multiple onChange={handleFileSelect} />
                </div>
                <span className="text-[10px] text-slate-300">Enter to send, Shift+Enter for new line</span>
              </div>
            </div>
            <button onClick={handleSend} disabled={!input.trim() || isLoading || attachments.some(a => !a.isImage && a.status !== "ready" && a.status !== undefined)}
              className="p-3 rounded-2xl bg-[#5b8c15] text-white hover:bg-[#4a7012] transition-colors disabled:opacity-40 shrink-0 mb-1">
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
      </div>{/* end flex body */}
    </div>
  );
}
