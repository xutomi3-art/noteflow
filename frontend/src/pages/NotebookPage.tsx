import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Files,
  ArrowLeft,
  Plus,
  Globe,
  Mic,
  Network,
  FileText,
  Presentation,
  Edit3,
  Loader2,
  Users,
  MoreVertical,
  PanelLeftClose,
  PanelRightClose,
  BookmarkPlus,
  Copy,
  ThumbsUp,
  ThumbsDown,
  X,
  Trash2,
} from "lucide-react";
import { useSourceStore } from "@/stores/source-store";
import { useChatStore } from "@/stores/chat-store";
import { useStudioStore } from "@/stores/studio-store";
import { api } from "@/services/api";
import type { Notebook, Source, ChatMessage } from "@/types/api";

/* ─── helpers ─── */

function fileTypeColor(fileType: string): string {
  const t = fileType.toLowerCase();
  if (t === "pdf") return "bg-red-100 text-red-600";
  if (t === "pptx") return "bg-amber-100 text-amber-600";
  if (t === "docx" || t === "doc") return "bg-blue-100 text-blue-600";
  if (t === "xlsx" || t === "csv") return "bg-green-100 text-green-600";
  return "bg-slate-100 text-slate-600"; // txt, md, etc.
}

function isProcessingStatus(status: Source["status"]): boolean {
  return status === "uploading" || status === "parsing" || status === "vectorizing";
}

function statusLabel(status: Source["status"]): string {
  if (status === "uploading") return "Uploading...";
  if (status === "parsing") return "Parsing...";
  if (status === "vectorizing") return "Vectorizing...";
  if (status === "failed") return "Failed";
  return "";
}

/** Render markdown-ish content with citation badges [1] [2] */
function renderContent(text: string): string {
  let html = text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Inline citations [n]
    .replace(
      /\[(\d+)\]/g,
      '<span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[9px] text-slate-500 ml-0.5 cursor-pointer hover:bg-slate-200">$1</span>',
    )
    // Line breaks
    .replace(/\n/g, "<br />");
  return html;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ─── component ─── */

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Local state
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [overview, setOverview] = useState<{ overview: string; suggested_questions: string[] } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [pptLoading, setPptLoading] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);

  // Stores
  const { sources, selectedIds, toggleSelect, selectAll, deselectAll, fetchSources, uploadSource, deleteSource, subscribeStatus, cleanup } =
    useSourceStore();
  const { messages, isStreaming, streamingContent, fetchHistory, sendMessage, reset: resetChat } = useChatStore();
  const {
    content: studioContent,
    isGenerating,
    notes,
    generateContent,
    fetchNotes,
    deleteNote,
    reset: resetStudio,
  } = useStudioStore();

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived
  const readySources = sources.filter((s) => s.status === "ready");
  const selectedCount = selectedIds.size;
  const isAllSelected = readySources.length > 0 && readySources.every((s) => selectedIds.has(s.id));
  const hasProcessingSelected = sources.some((s) => selectedIds.has(s.id) && isProcessingStatus(s.status));
  const canSend = chatInput.trim().length > 0 && !isStreaming && !hasProcessingSelected && readySources.length > 0;

  // Data loading
  useEffect(() => {
    if (!id) return;

    api.getNotebook(id).then(setNotebook).catch(() => {});
    fetchSources(id);
    subscribeStatus(id);
    fetchHistory(id);
    fetchNotes(id);
    api.getOverview(id).then(setOverview).catch(() => {});

    return () => {
      cleanup();
      resetChat();
      resetStudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Handlers
  const handleSend = useCallback(() => {
    if (!id || !canSend) return;
    sendMessage(id, chatInput.trim(), [...selectedIds]);
    setChatInput("");
  }, [id, canSend, chatInput, selectedIds, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!id || !e.target.files) return;
      const files = Array.from(e.target.files);
      for (const file of files) {
        await uploadSource(id, file);
      }
      e.target.value = "";
    },
    [id, uploadSource],
  );

  const handleSuggestedQuestion = useCallback(
    (q: string) => {
      if (!id || isStreaming) return;
      sendMessage(id, q, [...selectedIds]);
    },
    [id, isStreaming, selectedIds, sendMessage],
  );

  const handleSaveNote = useCallback(
    async (content: string) => {
      if (!id || !content.trim()) return;
      const note = await api.saveNote(id, content.trim());
      // Refresh notes
      fetchNotes(id);
      return note;
    },
    [id, fetchNotes],
  );

  const handleSaveMessageAsNote = useCallback(
    (msg: ChatMessage) => {
      handleSaveNote(msg.content);
    },
    [handleSaveNote],
  );

  const handleCopyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleToggleAll = useCallback(() => {
    if (isAllSelected) {
      deselectAll();
    } else {
      selectAll();
    }
  }, [isAllSelected, deselectAll, selectAll]);

  const handleStudioAction = useCallback(
    async (action: string) => {
      if (!id) return;
      if (action === "ppt") {
        setPptLoading(true);
        try {
          await api.downloadPPT(id);
        } catch (err) {
          console.error("PPT download failed:", err);
        } finally {
          setPptLoading(false);
        }
      } else if (action === "podcast") {
        setPodcastLoading(true);
        try {
          const url = await api.generatePodcast(id);
          setPodcastUrl(url);
        } catch (err) {
          console.error("Podcast generation failed:", err);
        } finally {
          setPodcastLoading(false);
        }
      } else {
        await generateContent(id, action);
      }
    },
    [id, generateContent],
  );

  const handleDeleteSource = useCallback(
    async (e: React.MouseEvent, sourceId: string) => {
      e.stopPropagation();
      if (!id) return;
      await deleteSource(id, sourceId);
    },
    [id, deleteSource],
  );

  return (
    <div className="h-screen flex flex-col bg-[#f0f2f5] font-sans text-slate-900 overflow-hidden select-none">
      {/* Header */}
      <header className="h-14 bg-[#f0f2f5] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-600"
          >
            <div className="bg-[#5b8c15] p-1 rounded-md">
              <Files className="w-4 h-4 text-white" />
            </div>
          </button>
          <span className="font-semibold text-[15px] text-slate-800 truncate max-w-[300px]">
            {notebook?.name || "Loading..."}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 bg-[#5b8c15] text-white px-4 py-1.5 rounded-full text-[13px] font-medium hover:bg-[#4a7311] transition-colors shadow-sm">
            <Users className="w-3.5 h-3.5" /> Share
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden px-4 pb-4 gap-0">
        {/* Left Panel: Sources */}
        <section
          className={`bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shrink-0 shadow-sm transition-all duration-300 ${isLeftCollapsed ? "w-0 border-none" : "w-[300px]"}`}
        >
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-4 shrink-0">
            <h2 className="text-[13px] font-semibold text-slate-700">Sources</h2>
            <button
              onClick={() => setIsLeftCollapsed(true)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.csv"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2 border border-slate-200 rounded-full text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors mb-4"
            >
              <Plus className="w-3.5 h-3.5" /> Add sources
            </button>

            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[11px] font-medium text-slate-500">Select all sources</span>
              <input
                type="checkbox"
                className="rounded text-[#5b8c15] focus:ring-[#5b8c15] w-3.5 h-3.5 border-slate-300 cursor-pointer"
                checked={isAllSelected}
                onChange={handleToggleAll}
              />
            </div>

            <div className="space-y-1">
              {sources.map((source) => (
                <div
                  key={source.id}
                  onClick={() => toggleSelect(source.id)}
                  className={`flex items-start gap-3 p-2 hover:bg-slate-50 rounded-xl cursor-pointer group transition-colors ${selectedIds.has(source.id) ? "bg-slate-50/50" : ""}`}
                >
                  <div
                    className={`${fileTypeColor(source.file_type)} p-1.5 rounded flex-shrink-0 mt-0.5`}
                  >
                    {isProcessingStatus(source.status) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-[13px] truncate ${isProcessingStatus(source.status) ? "text-slate-400 italic" : source.status === "failed" ? "text-red-500" : "text-slate-700"}`}
                    >
                      {source.filename}
                    </p>
                    {isProcessingStatus(source.status) && (
                      <span className="text-[10px] text-amber-500 font-medium">
                        {statusLabel(source.status)}
                      </span>
                    )}
                    {source.status === "failed" && (
                      <span className="text-[10px] text-red-500 font-medium">
                        {source.error_message || "Failed"}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDeleteSource(e, source.id)}
                    className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all mt-0.5 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="checkbox"
                    className="rounded text-[#5b8c15] focus:ring-[#5b8c15] w-3.5 h-3.5 border-slate-300 mt-0.5 pointer-events-none"
                    checked={selectedIds.has(source.id)}
                    readOnly
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Left Toggle */}
        {isLeftCollapsed && (
          <div className="w-12 flex items-start justify-center pt-4 shrink-0">
            <button
              onClick={() => setIsLeftCollapsed(false)}
              className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
            >
              <PanelLeftClose className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}

        {/* Center Panel: Chat */}
        <section className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm relative">
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-6 shrink-0">
            <h2 className="text-[13px] font-semibold text-slate-700">Chat</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-8 pb-32">
            <div className="max-w-3xl mx-auto">
              {/* Notebook Overview */}
              <div className="mb-10 text-center">
                <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Globe className="w-7 h-7 text-blue-500" />
                </div>
                <h1 className="text-[28px] font-bold text-slate-900 mb-2 leading-tight">
                  {notebook?.name || ""}
                </h1>
                <p className="text-[13px] text-slate-500 mb-6">
                  {selectedCount} sources selected
                </p>

                {overview?.overview && (
                  <div className="text-left text-[15px] text-slate-700 leading-relaxed space-y-4 mb-8">
                    <div dangerouslySetInnerHTML={{ __html: renderContent(overview.overview) }} />
                  </div>
                )}

                {overview?.overview && (
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                      onClick={() => handleSaveNote(overview.overview)}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" /> Save to note
                    </button>
                    <button
                      onClick={() => handleCopyToClipboard(overview.overview)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Suggested Questions */}
              {overview?.suggested_questions && overview.suggested_questions.length > 0 && messages.length === 0 && (
                <div className="flex flex-col gap-2 mb-12 max-w-xl mx-auto">
                  {overview.suggested_questions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestedQuestion(q)}
                      className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-xl text-[13px] text-slate-700 transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* Chat History */}
              <div className="space-y-8">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="bg-[#eef1f5] text-slate-800 px-5 py-3 rounded-2xl rounded-tr-sm max-w-[80%] text-[14px]">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="text-slate-800 text-[14px] leading-relaxed max-w-full">
                          <div dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />
                          <div className="flex items-center gap-2 mt-4">
                            <button
                              onClick={() => handleSaveMessageAsNote(msg)}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-200 text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                            >
                              <BookmarkPlus className="w-3 h-3" /> Save to note
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(msg.content)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Streaming bubble */}
                {isStreaming && streamingContent && (
                  <div className="flex justify-start">
                    <div className="text-slate-800 text-[14px] leading-relaxed max-w-full">
                      <div dangerouslySetInnerHTML={{ __html: renderContent(streamingContent) }} />
                      <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-0.5 rounded-sm" />
                    </div>
                  </div>
                )}

                {/* Streaming without content yet — typing indicator */}
                {isStreaming && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1 px-4 py-3">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>
          </div>

          {/* Chat Input Area */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-10 pb-6 px-8">
            <div className="max-w-3xl mx-auto">
              <div
                className={`relative bg-white border rounded-2xl shadow-sm flex items-center px-2 py-2 transition-all ${
                  hasProcessingSelected || readySources.length === 0
                    ? "border-slate-100 bg-slate-50/50"
                    : "border-slate-200 focus-within:ring-2 focus-within:ring-[#5b8c15]/20 focus-within:border-[#5b8c15]"
                }`}
              >
                <input
                  type="text"
                  placeholder={
                    readySources.length === 0
                      ? "Upload sources to start chatting..."
                      : hasProcessingSelected
                        ? "Waiting for sources to finish processing..."
                        : "Start typing..."
                  }
                  className="flex-1 bg-transparent border-none outline-none px-4 text-[14px] text-slate-700 disabled:cursor-not-allowed"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming || hasProcessingSelected || readySources.length === 0}
                />
                <div className="flex items-center gap-2 pr-1">
                  <span className="text-[11px] text-slate-400 font-medium px-2">
                    {selectedCount} sources
                  </span>
                  <button
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                      canSend ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-300"
                    }`}
                    disabled={!canSend}
                    onClick={handleSend}
                  >
                    <ArrowLeft className="w-4 h-4 rotate-180" />
                  </button>
                </div>
              </div>
              <div className="text-center mt-3 text-[10px] text-slate-400">
                Noteflow can be inaccurate; please double-check its responses.
              </div>
            </div>
          </div>
        </section>

        {/* Right Toggle */}
        {isRightCollapsed && (
          <div className="w-12 flex items-start justify-center pt-4 shrink-0">
            <button
              onClick={() => setIsRightCollapsed(false)}
              className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
            >
              <PanelRightClose className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}

        {/* Right Panel: Studio */}
        <section
          className={`bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shrink-0 shadow-sm relative transition-all duration-300 ${isRightCollapsed ? "w-0 border-none" : "w-[340px]"}`}
        >
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-4 shrink-0">
            <h2 className="text-[13px] font-semibold text-slate-700">Studio</h2>
            <button
              onClick={() => setIsRightCollapsed(true)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 pb-24">
            <div className="grid grid-cols-2 gap-2.5 mb-8">
              {/* Summary */}
              <button
                onClick={() => handleStudioAction("summary")}
                disabled={isGenerating.summary}
                className="bg-[#eef2ff] hover:bg-indigo-100 border border-indigo-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {isGenerating.summary ? (
                  <Loader2 className="w-4 h-4 text-indigo-600 mb-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 text-indigo-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-indigo-900">Summary</div>
              </button>

              {/* FAQ */}
              <button
                onClick={() => handleStudioAction("faq")}
                disabled={isGenerating.faq}
                className="bg-[#ecfeff] hover:bg-cyan-100 border border-cyan-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {isGenerating.faq ? (
                  <Loader2 className="w-4 h-4 text-cyan-600 mb-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 text-cyan-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-cyan-900">FAQ</div>
              </button>

              {/* Slide Deck */}
              <button
                onClick={() => handleStudioAction("ppt")}
                disabled={pptLoading}
                className="bg-[#fff7ed] hover:bg-orange-100 border border-orange-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {pptLoading ? (
                  <Loader2 className="w-4 h-4 text-orange-600 mb-2 animate-spin" />
                ) : (
                  <Presentation className="w-4 h-4 text-orange-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-orange-900">Slide Deck</div>
              </button>

              {/* Mind Map */}
              <button
                onClick={() => handleStudioAction("mindmap")}
                disabled={isGenerating.mindmap}
                className="bg-[#fdf2f8] hover:bg-pink-100 border border-pink-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {isGenerating.mindmap ? (
                  <Loader2 className="w-4 h-4 text-pink-600 mb-2 animate-spin" />
                ) : (
                  <Network className="w-4 h-4 text-pink-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-pink-900">Mind Map</div>
              </button>

              {/* Podcast */}
              <button
                onClick={() => handleStudioAction("podcast")}
                disabled={podcastLoading}
                className="bg-[#f5f3ff] hover:bg-purple-100 border border-purple-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {podcastLoading ? (
                  <Loader2 className="w-4 h-4 text-purple-600 mb-2 animate-spin" />
                ) : (
                  <Mic className="w-4 h-4 text-purple-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-purple-900">Podcast</div>
              </button>
            </div>

            {/* Generated Content Display */}
            {(studioContent.summary || studioContent.faq || studioContent.mindmap) && (
              <div className="mb-6 space-y-4">
                {studioContent.summary && (
                  <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h4 className="text-[11px] font-bold text-indigo-600 mb-2">SUMMARY</h4>
                    <div
                      className="text-[13px] text-slate-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderContent(studioContent.summary) }}
                    />
                  </div>
                )}
                {studioContent.faq && (
                  <div className="p-3 bg-cyan-50 rounded-xl border border-cyan-100">
                    <h4 className="text-[11px] font-bold text-cyan-600 mb-2">FAQ</h4>
                    <div
                      className="text-[13px] text-slate-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderContent(studioContent.faq) }}
                    />
                  </div>
                )}
                {studioContent.mindmap && (
                  <div className="p-3 bg-pink-50 rounded-xl border border-pink-100">
                    <h4 className="text-[11px] font-bold text-pink-600 mb-2">MIND MAP</h4>
                    <div
                      className="text-[13px] text-slate-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderContent(studioContent.mindmap) }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Podcast Player */}
            {podcastUrl && (
              <div className="mb-6 p-3 bg-purple-50 rounded-xl border border-purple-100">
                <h4 className="text-[11px] font-bold text-purple-600 mb-2">PODCAST</h4>
                <audio controls className="w-full" src={podcastUrl} />
              </div>
            )}

            {/* Saved Notes */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] font-bold text-slate-400 tracking-wider">SAVED NOTES</h3>
              </div>

              <div className="space-y-3">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 rounded-xl hover:bg-slate-50 cursor-pointer group transition-colors border border-transparent hover:border-slate-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-[13px] font-medium text-slate-800 line-clamp-2">
                            {note.content.slice(0, 80)}
                            {note.content.length > 80 ? "..." : ""}
                          </h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {timeAgo(note.created_at)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => id && deleteNote(id, note.id)}
                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {notes.length === 0 && (
                  <p className="text-[12px] text-slate-400 text-center py-4">
                    No saved notes yet
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Add Note Button */}
          <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none">
            {showNoteInput ? (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-3 mx-4 pointer-events-auto w-full max-w-[300px]">
                <textarea
                  autoFocus
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Write a note..."
                  className="w-full text-[13px] border-none outline-none resize-none h-20 text-slate-700"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => {
                      setShowNoteInput(false);
                      setNoteInput("");
                    }}
                    className="px-3 py-1 text-[12px] text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      await handleSaveNote(noteInput);
                      setNoteInput("");
                      setShowNoteInput(false);
                    }}
                    disabled={!noteInput.trim()}
                    className="px-3 py-1 text-[12px] bg-[#5b8c15] text-white rounded-lg hover:bg-[#4a7311] transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowNoteInput(true)}
                className="flex items-center gap-2 bg-[#5b8c15] text-white px-5 py-2.5 rounded-full text-[13px] font-medium shadow-lg hover:bg-[#4a7311] transition-transform hover:-translate-y-0.5 pointer-events-auto"
              >
                <Edit3 className="w-4 h-4" /> Add note
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
