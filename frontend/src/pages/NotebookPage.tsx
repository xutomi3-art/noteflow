import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Check,
  Copy,
  ThumbsUp,
  ThumbsDown,
  X,
  Trash2,
  Table2,
  AlignLeft,
  Image as ImageIcon,
  LogOut,
  Brain,
  GripVertical,
  ListChecks,
  MessageSquare,
  Sparkles,
  Minimize2,
  Square,
} from "lucide-react";
import { useSourceStore } from "@/stores/source-store";
import { consumePendingUploadFiles, consumePendingUploadUrls } from "@/stores/pending-upload-store";
import { useChatStore } from "@/stores/chat-store";
import { useStudioStore } from "@/stores/studio-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSharingStore } from "@/stores/sharing-store";
import { api } from "@/services/api";
import type { Notebook, Source, ChatMessage } from "@/types/api";
import ShareModal from "@/components/sharing/ShareModal";
import PptConfigModal from "@/components/PptConfigModal";
import type { PptConfig } from "@/components/PptConfigModal";
import MarkdownContent from "@/components/MarkdownContent";
import MindMap from "@/components/MindMap";

/* ─── helpers ─── */

function fileTypeColor(fileType: string): string {
  const t = fileType.toLowerCase();
  if (t === "pdf") return "bg-red-100 text-red-600";
  if (t === "pptx") return "bg-amber-100 text-amber-600";
  if (t === "docx" || t === "doc") return "bg-blue-100 text-blue-600";
  if (t === "xlsx" || t === "csv") return "bg-green-100 text-green-600";
  if (["mp3", "wav", "m4a", "flac", "ogg", "webm"].includes(t)) return "bg-purple-100 text-purple-600";
  return "bg-slate-100 text-slate-600"; // txt, md, etc.
}

function fileTypeIcon(fileType: string): React.ReactNode {
  const t = fileType.toLowerCase();
  const cls = "w-3.5 h-3.5";
  if (t === "pdf") return <FileText className={cls} />;
  if (t === "pptx" || t === "ppt") return <Presentation className={cls} />;
  if (t === "docx" || t === "doc") return <FileText className={cls} />;
  if (t === "xlsx" || t === "xls" || t === "csv") return <Table2 className={cls} />;
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(t)) return <ImageIcon className={cls} />;
  if (["mp3", "wav", "m4a", "flac", "ogg", "webm"].includes(t)) return <Mic className={cls} />;
  if (t === "txt" || t === "md") return <AlignLeft className={cls} />;
  return <FileText className={cls} />;
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


/** Renders mind map content: JSON as visual mind map, otherwise markdown */
function MindMapContent({ content }: { content: string }) {
  let raw = content.trim();
  // Strip ```json fences
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(raw);
    return <MindMap data={parsed} />;
  } catch {
    return (
      <MarkdownContent
        content={content}
        className="text-[13px] text-slate-700 leading-relaxed"
      />
    );
  }
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

/**
 * Strip markdown syntax to get a plain-text preview string.
 * Used for collapsed note previews where line-clamp needs plain text.
 */
function stripMarkdownToText(markdown: string): string {
  return markdown
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove fenced code blocks
    .replace(/^```[\s\S]*?^```/gm, "")
    // Remove table separator rows (| --- | --- |)
    .replace(/^\|[\s:-]+\|\s*$/gm, "")
    // Remove table pipe delimiters but keep cell content
    .replace(/^\|(.+)\|$/gm, (_m, cells: string) => cells.split("|").map((c: string) => c.trim()).filter(Boolean).join(" · "))
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Remove list markers
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    // Collapse multiple newlines to a single space
    .replace(/\n+/g, " ")
    .trim();
}

/**
 * Renders a saved note: detects JSON mindmap and shows a tree view,
 * otherwise renders with MarkdownContent.
 */
function NoteContent({ content, className }: { content: string; className?: string }) {
  // Check if this note contains raw JSON mindmap data
  let raw = content.trim();
  // Strip a leading label line like "**Mind Map**\n\n" before the JSON
  const jsonStart = raw.indexOf("{");
  const jsonFragment = jsonStart >= 0 ? raw.slice(jsonStart) : raw;
  if (jsonFragment.startsWith("{") || jsonFragment.startsWith("[")) {
    try {
      const parsed = JSON.parse(jsonFragment);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (Array.isArray((parsed as Record<string, unknown>).nodes) ||
          Array.isArray((parsed as Record<string, unknown>).children))
      ) {
        // It's a mindmap JSON — render as indented tree
        const prefix = raw.slice(0, jsonStart).trim();
        return (
          <div className={className}>
            {prefix && (
              <MarkdownContent content={prefix} className="text-[13px] text-slate-700 leading-relaxed mb-2" />
            )}
            <MindMapTreeView data={parsed} />
          </div>
        );
      }
    } catch {
      // Not valid JSON, fall through to MarkdownContent
    }
  }
  return <MarkdownContent content={content} className={className} />;
}

interface MindMapNode {
  id?: string | number;
  label?: string;
  name?: string;
  topic?: string;
  title?: string;
  text?: string;
  level?: number;
  children?: MindMapNode[];
  nodes?: MindMapNode[];
  items?: MindMapNode[];
  parent?: string | number;
}

const TREE_COLORS = ["#7c3aed", "#4f46e5", "#0891b2", "#0d9488", "#059669", "#ca8a04"];

function MindMapTreeView({ data }: { data: unknown }) {
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as MindMapNode[])
    : Array.isArray((data as Record<string, unknown>).children)
    ? ((data as Record<string, unknown>).children as MindMapNode[])
    : [];

  if (nodes.length === 0) return null;

  // Find root nodes (no parent or level === 0)
  const rootNodes = nodes.filter((n) => !n.parent && (n.level === undefined || n.level === 0));
  if (rootNodes.length === 0) return null;

  function renderNode(node: MindMapNode, depth: number): React.ReactNode {
    const label = node.label || node.name || node.topic || node.title || node.text || "";
    const color = depth === 0 ? "#e11d48" : TREE_COLORS[(depth - 1) % TREE_COLORS.length];
    const children = nodes.filter(
      (n) =>
        n.parent !== undefined &&
        String(n.parent) === String(node.id ?? label) &&
        n !== node
    );

    return (
      <div key={`${label}-${depth}`} style={{ marginLeft: depth * 16 }}>
        <div className="flex items-center gap-1.5 py-0.5">
          <span
            className="inline-block rounded-full shrink-0"
            style={{
              width: depth === 0 ? 8 : 6,
              height: depth === 0 ? 8 : 6,
              background: color,
            }}
          />
          <span
            className="text-[12px] leading-snug"
            style={{ color: depth === 0 ? "#111827" : "#374151", fontWeight: depth === 0 ? 600 : 400 }}
          >
            {label}
          </span>
        </div>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="py-1 space-y-0.5">
      {rootNodes.map((n) => renderNode(n, 0))}
    </div>
  );
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
  const [mobileTab, setMobileTab] = useState<"sources" | "chat" | "studio">("chat");
  const [noteInput, setNoteInput] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptModalOpen, setPptModalOpen] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);
  const [isDragging, setIsDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [overviewSaved, setOverviewSaved] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<{ id: number; name: string; status: 'uploading' | 'processing' | 'error' | 'cancelled'; progress: number; sourceId?: string }[]>([]);
  const uploadControllersRef = useRef<Map<number, AbortController>>(new Map());
  const uploadIdCounterRef = useRef(0);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Auto-collapse/expand panels based on window width
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w >= 768 && w < 900) {
        setIsLeftCollapsed(true);
        setIsRightCollapsed(true);
      } else if (w >= 900 && w < 1100) {
        setIsLeftCollapsed(true);
        setIsRightCollapsed(false);
      } else if (w >= 1100) {
        setIsLeftCollapsed(false);
        setIsRightCollapsed(false);
      }
    };
    handleResize(); // Run on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const sourceContentRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<"left" | "right" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  // Stores
  const { user, logout } = useAuthStore();
  const { sources, selectedIds, toggleSelect, selectAll, deselectAll, fetchSources, uploadSource, deleteSource, subscribeStatus, cleanup, activeSourceId, activeSourceContent, isLoadingContent, setActiveSource, clearActiveSource, highlightExcerpt } =
    useSourceStore();
  const { messages, isStreaming, streamingContent, thinking, setThinking, reasoningContent, isThinkingPhase, fetchHistory, sendMessage, stopStream, reset: resetChat } = useChatStore();
  const {
    content: studioContent,
    isGenerating,
    notes,
    pdfViewer,
    generateContent,
    clearContent,
    fetchNotes,
    deleteNote,
    closePdf,
    reset: resetStudio,
  } = useStudioStore();
  const { members, fetchMembers, removeMember } = useSharingStore();

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived
  const readySources = sources.filter((s) => s.status === "ready");
  const selectedCount = selectedIds.size;
  const isAllSelected = readySources.length > 0 && readySources.every((s) => selectedIds.has(s.id));
  const hasProcessingSelected = sources.some((s) => selectedIds.has(s.id) && isProcessingStatus(s.status));
  const canSend = chatInput.trim().length > 0 && !isStreaming && !hasProcessingSelected && readySources.length > 0 && selectedIds.size > 0;

  // Data loading
  useEffect(() => {
    if (!id) return;

    api.getNotebook(id).then((nb) => {
      setNotebook(nb);
      if (nb.is_shared) fetchMembers(id);
    }).catch(() => { setNotFound(true); });
    fetchSources(id);
    subscribeStatus(id);
    fetchHistory(id);
    fetchNotes(id);
    api.getOverview(id).then(setOverview).catch(() => {});

    return () => {
      cleanup();
      resetChat();
      resetStudio();
      setSavedMessageIds(new Set());
      setOverviewSaved(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Consume pending files and URLs from create-notebook flow and upload them
  useEffect(() => {
    if (!id) return;
    const files = consumePendingUploadFiles();
    const urls = consumePendingUploadUrls();
    if (files.length === 0 && urls.length === 0) return;

    const fileIds = files.map(() => ++uploadIdCounterRef.current);
    const urlIds = urls.map(() => ++uploadIdCounterRef.current);
    const fileUploads = files.map((f, i) => ({ id: fileIds[i], name: f.name, status: 'uploading' as const, progress: 0 }));
    const urlUploads = urls.map((u, i) => ({ id: urlIds[i], name: u, status: 'uploading' as const, progress: 0 }));
    setPendingUploads([...fileUploads, ...urlUploads]);

    (async () => {
      // Upload files first
      for (let i = 0; i < files.length; i++) {
        const uploadId = fileIds[i];
        try {
          const uploaded = await uploadSource(id, files[i]);
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'processing' as const, progress: 100, sourceId: uploaded.id } : u));
        } catch {
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'error' as const } : u));
        }
      }
      // Then add URLs
      for (let i = 0; i < urls.length; i++) {
        const uploadId = urlIds[i];
        try {
          const uploaded = await api.addUrlSource(id, urls[i]);
          fetchSources(id);
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'processing' as const, progress: 100, sourceId: uploaded.id } : u));
        } catch {
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'error' as const } : u));
        }
      }
      // Clear pending uploads after a delay so user can see final states
      setTimeout(() => setPendingUploads([]), 3000);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Remove pending uploads whose linked source has reached "ready" status
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const readySourceIds = new Set(sources.filter(s => s.status === 'ready').map(s => s.id));
    const hasReady = pendingUploads.some(u => u.sourceId && readySourceIds.has(u.sourceId));
    if (hasReady) {
      setPendingUploads(prev => prev.filter(u => !u.sourceId || !readySourceIds.has(u.sourceId)));
    }
  }, [sources, pendingUploads]);

  // Re-fetch overview when first source becomes ready (for newly created notebooks)
  const readyCount = sources.filter(s => s.status === "ready").length;
  const prevReadyRef = useRef(0);
  useEffect(() => {
    if (!id) return;
    if (readyCount > 0 && prevReadyRef.current === 0 && !overview) {
      api.getOverview(id).then(setOverview).catch(() => {});
    }
    prevReadyRef.current = readyCount;
  }, [id, readyCount, overview]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, reasoningContent]);

  // Scroll to and highlight excerpt in source content viewer
  useEffect(() => {
    if (!activeSourceContent || !highlightExcerpt || !sourceContentRef.current) return;

    // Wait for DOM to render
    const timer = setTimeout(() => {
      const container = sourceContentRef.current;
      if (!container) return;

      // Remove previous highlights
      container.querySelectorAll("mark.citation-highlight").forEach((el) => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ""), el);
          parent.normalize();
        }
      });

      // Normalize text by stripping HTML tags, markdown syntax, and extra whitespace
      const toPlainText = (s: string) =>
        s
          .replace(/<[^>]+>/g, "")           // strip HTML tags
          .replace(/^#{1,6}\s+/gm, "")       // strip heading markers
          .replace(/\*\*(.+?)\*\*/g, "$1")   // strip bold
          .replace(/\*(.+?)\*/g, "$1")       // strip italic
          .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, "")) // strip code markers
          .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, " "))   // strip table pipes
          .replace(/^[-|:\s]+$/gm, "")       // strip table separator rows
          .replace(/^[-*]\s+/gm, "")         // strip list markers
          .replace(/^\d+\.\s+/gm, "")        // strip ordered list markers
          .replace(/\s+/g, " ")              // normalize whitespace
          .trim();

      const excerpt = toPlainText(highlightExcerpt);
      if (!excerpt || excerpt.length < 4) return;

      // Strip all non-content chars for matching (block elements concatenate without spaces,
      // DOM has pipe chars from markdown tables that excerpts don't)
      const toKey = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

      // Walk text nodes to build full text
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const allText: { node: Text; start: number }[] = [];
      let fullText = "";
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        allText.push({ node, start: fullText.length });
        fullText += node.textContent || "";
      }

      const keyFull = toKey(fullText);
      const keyExcerpt = toKey(excerpt);

      // Try progressively shorter substrings for matching
      let matchIdx = -1;
      const tryLengths = [keyExcerpt.length, 60, 40, 20, 12];
      for (const len of tryLengths) {
        if (len >= keyExcerpt.length) {
          matchIdx = keyFull.indexOf(keyExcerpt);
        } else if (keyExcerpt.length > len) {
          matchIdx = keyFull.indexOf(keyExcerpt.slice(0, len));
        }
        if (matchIdx !== -1) break;
      }

      if (matchIdx === -1) return;

      // Map key index back to raw fullText index (skip non-letter/non-digit chars)
      const isContent = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
      let rawIdx = 0;
      let keyPos = 0;
      while (rawIdx < fullText.length && keyPos < matchIdx) {
        if (isContent(fullText[rawIdx])) {
          keyPos++;
        }
        rawIdx++;
      }
      // Skip any non-content chars at the match start
      while (rawIdx < fullText.length && !isContent(fullText[rawIdx])) rawIdx++;

      // Find the text node containing the match start
      for (const { node: textNode, start } of allText) {
        const nodeEnd = start + (textNode.textContent?.length || 0);
        if (start <= rawIdx && rawIdx < nodeEnd) {
          const localOffset = rawIdx - start;
          const markLen = Math.min(40, (textNode.textContent?.length || 0) - localOffset);
          if (markLen <= 0) break;
          const range = document.createRange();
          range.setStart(textNode, localOffset);
          range.setEnd(textNode, localOffset + markLen);

          const mark = document.createElement("mark");
          mark.className = "citation-highlight";
          mark.style.cssText = "background: #fef08a; padding: 2px 0; border-radius: 2px; scroll-margin-top: 80px;";
          try {
            range.surroundContents(mark);
          } catch {
            // If surroundContents fails (cross-element), just scroll to the range position
            const rect = range.getBoundingClientRect();
            container.scrollTo({ top: container.scrollTop + rect.top - container.getBoundingClientRect().top - 100, behavior: "smooth" });
            return;
          }

          mark.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [activeSourceContent, highlightExcerpt]);

  // Handlers
  const handleSend = useCallback(() => {
    if (!id || !canSend) return;
    sendMessage(id, chatInput.trim(), [...selectedIds], thinking);
    setChatInput("");
  }, [id, canSend, chatInput, selectedIds, sendMessage, thinking]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!chatInput.trim()) return;
        handleSend();
      }
    },
    [handleSend, chatInput],
  );

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!id || !e.target.files) return;
      const files = Array.from(e.target.files);
      const rejected: string[] = [];
      const accepted: File[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
        } else {
          accepted.push(file);
        }
      }
      if (rejected.length > 0) {
        alert(`The following files exceed the 50 MB limit and were skipped:\n\n${rejected.join('\n')}`);
      }
      // Assign stable unique IDs to each upload so cancel lookups are always correct
      const uploadIds = accepted.map(() => ++uploadIdCounterRef.current);
      // Show uploading state immediately
      const newUploads = accepted.map((f, i) => ({ id: uploadIds[i], name: f.name, status: 'uploading' as const, progress: 0 }));
      setPendingUploads(prev => [...prev, ...newUploads]);
      for (let i = 0; i < accepted.length; i++) {
        const controller = new AbortController();
        const uploadId = uploadIds[i];
        uploadControllersRef.current.set(uploadId, controller);
        try {
          const uploaded = await api.uploadSource(id, accepted[i], controller.signal, (progress) => {
            setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress } : u));
          });
          fetchSources(id);
          // Keep in pending with sourceId — will show processing status in same row
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'processing' as const, progress: 100, sourceId: uploaded.id } : u));
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'cancelled' as const } : u));
          } else {
            setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'error' as const } : u));
          }
        } finally {
          uploadControllersRef.current.delete(uploadId);
        }
      }
      // Clear cancelled/error uploads after 2s
      setTimeout(() => setPendingUploads(prev => prev.filter(u => u.status === 'uploading' || u.status === 'processing')), 2000);
      e.target.value = "";
    },
    [id, fetchSources, pendingUploads.length],
  );

  const handleAddUrl = useCallback(async () => {
    if (!urlInput.trim() || !id) return;
    try { new URL(urlInput.trim()); } catch {
      setUrlError("Please enter a valid URL starting with http:// or https://");
      return;
    }
    setIsAddingUrl(true);
    setUrlError(null);
    try {
      await api.addUrlSource(id, urlInput.trim());
      setUrlInput("");
      setShowUrlInput(false);
      setUrlError(null);
      fetchSources(id);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Failed to add URL");
    } finally {
      setIsAddingUrl(false);
    }
  }, [id, urlInput, fetchSources]);

  const handleSuggestedQuestion = useCallback(
    (q: string) => {
      if (!id || isStreaming) return;
      sendMessage(id, q, [...selectedIds], thinking);
    },
    [id, isStreaming, selectedIds, sendMessage, thinking],
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
    async (msg: ChatMessage) => {
      await handleSaveNote(msg.content);
      setSavedMessageIds((prev) => new Set(prev).add(msg.id));
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

  const handleMinimizeStudioContent = useCallback(
    async (contentType: string, content: string, label: string) => {
      let noteContent = content;

      // For mindmap, convert JSON to a readable text tree
      if (contentType === "mindmap") {
        let raw = content.trim();
        if (raw.startsWith("```")) {
          raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        try {
          const parsed = JSON.parse(raw);
          const lines: string[] = [];
          const walk = (node: unknown, depth: number) => {
            const indent = "  ".repeat(depth);
            if (typeof node === "string") {
              lines.push(`${indent}- ${node}`);
            } else if (Array.isArray(node)) {
              node.forEach((item) => walk(item, depth));
            } else if (node && typeof node === "object") {
              const obj = node as Record<string, unknown>;
              const nodeLabel = (obj.label || obj.name || obj.topic || obj.title || obj.text || "") as string;
              const children = (obj.children || obj.nodes || obj.items || []) as unknown[];
              if (nodeLabel) {
                if (depth === 0) {
                  lines.push(`# ${nodeLabel}`);
                } else {
                  lines.push(`${indent}- ${nodeLabel}`);
                }
                if (Array.isArray(children)) {
                  children.forEach((child) => walk(child, depth + 1));
                }
              } else {
                Object.entries(obj).forEach(([key, value]) => {
                  lines.push(`${indent}- **${key}**`);
                  if (typeof value === "object" && value !== null) {
                    walk(value, depth + 1);
                  } else {
                    lines.push(`${indent}  ${String(value)}`);
                  }
                });
              }
            }
          };
          walk(parsed, 0);
          noteContent = lines.join("\n");
        } catch {
          // If JSON parse fails, keep original content
        }
      }

      // Save to notes with a label prefix
      await handleSaveNote(`**${label}**\n\n${noteContent}`);
      // Clear from studio display
      clearContent(contentType);
    },
    [handleSaveNote, clearContent],
  );

  const handleStudioAction = useCallback(
    async (action: string) => {
      if (!id) return;
      if (action === "ppt") {
        setPptModalOpen(true);
        return;
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

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login");
  }, [logout, navigate]);

  /** Handle Ctrl+V paste image in chat */
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!id) return;
      const items = e.clipboardData.items;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            if (file.size > MAX_FILE_SIZE) {
              alert(`Pasted image (${(file.size / 1024 / 1024).toFixed(1)} MB) exceeds the 50 MB limit.`);
              return;
            }
            const ext = file.type.split("/")[1] || "png";
            const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type });
            await uploadSource(id, namedFile);
          }
          return;
        }
      }
    },
    [id, uploadSource],
  );

  /** Resizable panel drag */
  const handleDragStart = useCallback(
    (panel: "left" | "right", e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = panel;
      setIsDragging(true);
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = panel === "left" ? leftWidth : rightWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = ev.clientX - dragStartXRef.current;
        if (isDraggingRef.current === "left") {
          setLeftWidth(Math.max(180, Math.min(600, dragStartWidthRef.current + delta)));
        } else {
          setRightWidth(Math.max(200, Math.min(700, dragStartWidthRef.current - delta)));
        }
      };

      const handleMouseUp = () => {
        isDraggingRef.current = null;
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth, rightWidth],
  );

  /** Handle citation badge click — open source content viewer in left panel with highlighted excerpt */
  const handleCitationClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const badge = target.closest(".citation-badge") as HTMLElement | null;
      if (!badge) return;

      const citationIndex = parseInt(badge.dataset.citationIndex || "", 10);
      if (isNaN(citationIndex)) return;

      // Find the message that contains this citation
      const msgEl = badge.closest("[data-message-id]") as HTMLElement | null;
      const msgId = msgEl?.dataset.messageId;
      let msg = messages.find((m) => m.id === msgId);

      // Fallback: if no message parent found (e.g. overview citations), search all messages
      if (!msg) {
        msg = messages.find((m) => m.citations.some((c) => c.index === citationIndex));
      }
      if (!msg) return;

      const citation = msg.citations.find((c) => c.index === citationIndex);
      if (!citation || !citation.source_id) return;

      // Open source content in left panel with excerpt highlight
      if (id) {
        setActiveSource(id, citation.source_id, citation.excerpt || null);
        setIsLeftCollapsed(false);
      }
    },
    [messages, id, setActiveSource],
  );

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0f2f5] font-sans">
        <div className="text-center">
          <div className="text-6xl mb-4">📓</div>
          <h1 className="text-2xl font-semibold text-slate-800 mb-2">Notebook not found</h1>
          <p className="text-slate-500 mb-6">This notebook doesn't exist or you don't have access to it.</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-5 py-2.5 bg-[#5b8c15] text-white rounded-xl text-sm font-medium hover:bg-[#4a7310] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white font-sans text-slate-900 overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-2 md:px-4 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-600"
          >
            <img src="/logo.png" alt="Noteflow" className="w-6 h-6 rounded-md" />
          </button>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={editName}
              maxLength={100}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const trimmed = editName.trim();
                  if (trimmed && notebook && id && trimmed !== notebook.name) {
                    api.updateNotebook(id, { name: trimmed }).then((updated) => {
                      setNotebook(updated);
                    });
                  }
                  setIsEditingName(false);
                } else if (e.key === "Escape") {
                  setIsEditingName(false);
                }
              }}
              onBlur={() => {
                const trimmed = editName.trim();
                if (trimmed && notebook && id && trimmed !== notebook.name) {
                  api.updateNotebook(id, { name: trimmed }).then((updated) => {
                    setNotebook(updated);
                  });
                }
                setIsEditingName(false);
              }}
              className="font-semibold text-[15px] text-slate-800 max-w-[300px] bg-transparent border-b-2 border-blue-400 outline-none px-0 py-0.5"
              autoFocus
            />
          ) : (
            <span
              className={`font-semibold text-[15px] text-slate-800 truncate max-w-[300px] ${
                notebook?.user_role !== "viewer" ? "cursor-pointer hover:text-blue-600 transition-colors" : ""
              }`}
              onClick={() => {
                if (notebook && notebook.user_role !== "viewer") {
                  setEditName(notebook.name);
                  setIsEditingName(true);
                }
              }}
              title={notebook?.user_role !== "viewer" ? "Click to rename" : undefined}
            >
              {notebook?.name || "Loading..."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {notebook && !notebook.is_shared && notebook.user_role === 'owner' && (
            <button
              onClick={() => setIsShareModalOpen(true)}
              className="flex items-center gap-2 bg-[#5b8c15] text-white px-4 py-1.5 rounded-full text-[13px] font-medium hover:bg-[#4a7311] transition-colors shadow-sm"
            >
              <Users className="w-3.5 h-3.5" /> <span className="hidden md:inline">Share with Team</span>
            </button>
          )}
          <div className="text-right hidden md:block">
            <div className="font-semibold text-sm">{user?.name || "User"}</div>
            <div className="text-xs text-slate-500">{user?.email}</div>
          </div>
          <div
            className="relative"
            onMouseEnter={() => setIsProfileMenuOpen(true)}
            onMouseLeave={() => setIsProfileMenuOpen(false)}
          >
            <button className="w-9 h-9 rounded-full bg-[#5b8c15] text-white flex items-center justify-center font-bold text-sm hover:bg-[#4a7311] transition-colors">
              {(user?.name || "U").charAt(0).toUpperCase()}
            </button>
            {isProfileMenuOpen && (
              <div className="absolute top-full right-0 pt-2 w-48 z-20">
                <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 py-2">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 font-medium transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center bg-white border-b border-slate-200 shrink-0">
        {(
          [
            { key: "sources" as const, label: "Sources", icon: <Files className="w-4 h-4" /> },
            { key: "chat" as const, label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
            { key: "studio" as const, label: "Studio", icon: <Sparkles className="w-4 h-4" /> },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold transition-colors ${
              mobileTab === tab.key
                ? "text-[#5b8c15] border-b-2 border-[#5b8c15]"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden gap-0">
        {/* Left Panel: Sources */}
        <section
          style={!isMobile && !isLeftCollapsed ? { width: leftWidth } : undefined}
          className={`bg-white border-r border-slate-200 flex-col overflow-hidden shrink-0 ${!isDragging ? "transition-all duration-300" : ""} ${isLeftCollapsed && !isMobile ? "w-0 border-none" : ""} ${isMobile ? (mobileTab === "sources" ? "flex w-full" : "hidden") : "flex"}`}
        >
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-4 shrink-0 select-none">
            <h2 className="text-[13px] font-semibold text-slate-700">Sources</h2>
            <button
              onClick={() => setIsLeftCollapsed(true)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {activeSourceId ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
                <button
                  onClick={() => clearActiveSource()}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                >
                  <ArrowLeft className="w-4 h-4 text-slate-500" />
                </button>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {(() => {
                    const activeSource = sources.find((s) => s.id === activeSourceId);
                    if (!activeSource) return null;
                    return (
                      <>
                        <span className={`${fileTypeColor(activeSource.file_type)} text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0`}>
                          {activeSource.file_type}
                        </span>
                        <span className="text-[13px] font-semibold text-slate-700 truncate">
                          {activeSource.filename}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {isLoadingContent ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : activeSourceContent ? (
                  <div ref={sourceContentRef}>
                    <MarkdownContent
                      content={activeSourceContent}
                      className="text-[13px] leading-relaxed"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-8">Content not available</p>
                )}
              </div>
            </div>
          ) : (
          <div className="p-4 flex-1 overflow-y-auto" onPaste={notebook?.user_role !== "viewer" ? handlePaste : undefined}>
            {notebook?.user_role !== "viewer" && (
              <>
                <input
                  id="notebook-file-input"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                  className="sr-only"
                  onChange={handleFileUpload}
                />
                {!showUrlInput ? (
                  <label
                    htmlFor="notebook-file-input"
                    className="w-full flex flex-col items-center justify-center gap-1 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-center cursor-pointer hover:border-[#5b8c15]/40 hover:bg-slate-50/50 transition-colors mb-2"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files.length > 0) {
                        const dt = new DataTransfer();
                        Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
                        if (fileInputRef.current) {
                          fileInputRef.current.files = dt.files;
                          fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                      }
                    }}
                  >
                    <Plus className="w-4 h-4 text-slate-400" />
                    <span className="text-[13px] font-medium text-slate-600">Add sources</span>
                    <span className="text-[10px] text-slate-400">
                      pdf, images, docs,{' '}
                      <span className="relative group/tip inline-block">
                        <span className="underline decoration-dotted underline-offset-2 cursor-default">and more</span>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-slate-900 text-white text-[10px] leading-relaxed px-2.5 py-2 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 z-50 shadow-lg">
                          Supported: pdf, txt, md, docx, pptx, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp
                        </span>
                      </span>
                    </span>
                    <span className="text-[10px] text-slate-400">Drag, browse, or paste image</span>
                  </label>
                ) : (
                  <div className="w-full flex flex-col gap-2 p-3 border-2 border-dashed border-[#5b8c15]/30 bg-slate-50/50 rounded-2xl mb-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={urlInput}
                        onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddUrl(); }}
                        placeholder="https://example.com/article"
                        className="flex-1 text-[13px] bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#5b8c15]/40 focus:border-[#5b8c15]/40"
                        autoFocus
                        disabled={isAddingUrl}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setShowUrlInput(false); setUrlInput(""); }}
                        className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                        disabled={isAddingUrl}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddUrl}
                        disabled={!urlInput.trim() || isAddingUrl}
                        className="text-[12px] font-medium text-white bg-[#5b8c15] hover:bg-[#4a7312] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        {isAddingUrl ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Add
                      </button>
                    </div>
                    {urlError && (
                      <p className="text-[11px] text-red-500 mt-1 px-1">{urlError}</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[12px] text-slate-500 hover:text-[#5b8c15] hover:bg-slate-50 rounded-xl transition-colors mb-4"
                >
                  {showUrlInput ? (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Upload file instead</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>Add URL</span>
                    </>
                  )}
                </button>
              </>
            )}

            <div className="flex items-center gap-3 p-2 mb-1">
              <span className="text-[11px] font-medium text-slate-500 flex-1">Select all sources</span>
              <div className="w-[18px] shrink-0" />
              <input
                type="checkbox"
                className="rounded text-[#5b8c15] focus:ring-[#5b8c15] w-3.5 h-3.5 border-slate-300 cursor-pointer shrink-0"
                checked={isAllSelected}
                onChange={handleToggleAll}
              />
            </div>

            <div className="space-y-1">
              {/* Pending uploads — shown inline with sources */}
              {pendingUploads.map((upload) => {
                // Get linked source's processing status
                const linkedSource = upload.sourceId ? sources.find(s => s.id === upload.sourceId) : null;
                const processingLabel = linkedSource ? statusLabel(linkedSource.status) : null;
                return (
                <div key={`pending-${upload.id}`} className="relative overflow-hidden rounded-xl bg-slate-50">
                  {/* Progress bar fill */}
                  {upload.status === 'uploading' && (
                    <div
                      className="absolute inset-y-0 left-0 bg-[#dcfce7] transition-all duration-300 ease-out"
                      style={{ width: `${upload.progress}%` }}
                    />
                  )}
                  {upload.status === 'processing' && (
                    <div className="absolute inset-0 bg-[#dcfce7]" />
                  )}
                  <div className="relative flex items-center gap-3 p-2">
                    <div className={`p-1.5 rounded flex-shrink-0 ${upload.status === 'error' || upload.status === 'cancelled' ? 'bg-red-50 text-red-400' : 'bg-white/60 text-[#5b8c15]'}`}>
                      {upload.status === 'uploading' || upload.status === 'processing' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] truncate ${upload.status === 'error' || upload.status === 'cancelled' ? 'text-red-500' : 'text-slate-700'}`}>
                        {upload.name}
                      </p>
                      {upload.status === 'uploading' && (
                        <p className="text-[11px] text-[#5b8c15] font-medium">uploading... {upload.progress}%</p>
                      )}
                      {upload.status === 'processing' && processingLabel && (
                        <p className="text-[11px] text-amber-500 font-medium">{processingLabel}</p>
                      )}
                      {upload.status === 'cancelled' && (
                        <p className="text-[11px] text-slate-400">cancelled</p>
                      )}
                    </div>
                    {upload.status === 'uploading' && (
                      <button
                        onClick={() => {
                          const controller = uploadControllersRef.current.get(upload.id);
                          if (controller) controller.abort();
                        }}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                        title="Cancel upload"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
              {sources.filter(s => !pendingUploads.some(u => u.sourceId === s.id)).map((source) => (
                <div
                  key={source.id}
                  className={`flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl cursor-pointer group transition-colors ${selectedIds.has(source.id) ? "bg-slate-50/50" : ""}`}
                >
                  <div
                    className={`${fileTypeColor(source.file_type)} p-1.5 rounded flex-shrink-0`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (source.status === "ready" && id) {
                        setActiveSource(id, source.id);
                      }
                    }}
                  >
                    {isProcessingStatus(source.status) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      fileTypeIcon(source.file_type)
                    )}
                  </div>
                  <div
                    className="flex-1 min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (source.status === "ready" && id) {
                        setActiveSource(id, source.id);
                      } else {
                        toggleSelect(source.id);
                      }
                    }}
                  >
                    <p
                      className={`text-[13px] truncate ${isProcessingStatus(source.status) ? "text-slate-400 italic" : source.status === "failed" ? "text-red-500" : "text-slate-700 hover:text-[#5b8c15]"}`}
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
                  {notebook?.user_role !== "viewer" && (
                    <button
                      onClick={(e) => handleDeleteSource(e, source.id)}
                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-0.5 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <input
                    type="checkbox"
                    className="rounded text-[#5b8c15] focus:ring-[#5b8c15] w-3.5 h-3.5 border-slate-300 cursor-pointer shrink-0"
                    checked={selectedIds.has(source.id)}
                    onChange={() => toggleSelect(source.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Team Members (shown for team notebooks) */}
          {notebook?.is_shared && (
            <div className="border-t border-slate-100 px-4 py-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                  Team ({members.length})
                </h3>
                {notebook?.user_role === 'owner' && (
                  <button
                    onClick={() => setIsShareModalOpen(true)}
                    className="text-[12px] text-[#5b8c15] hover:text-[#4a7311] font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Invite
                  </button>
                )}
              </div>
              <div className="space-y-1 max-h-[120px] overflow-y-auto">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-2 py-1 group"
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                      member.status === "pending"
                        ? "bg-slate-200 text-slate-500"
                        : "bg-[#5b8c15] text-white"
                    }`}>
                      {(member.name || member.email || "U").charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-[12px] flex-1 truncate ${
                      member.status === "pending" ? "text-slate-400 italic" : "text-slate-700"
                    }`}>
                      {member.name || member.email}
                    </span>
                    {member.status === "pending" ? (
                      <span className="text-[10px] text-amber-500 font-medium w-12 text-right shrink-0">Pending</span>
                    ) : (
                      <span className="text-[10px] text-slate-400 capitalize w-12 text-right shrink-0">{member.role}</span>
                    )}
                    {notebook?.user_role === "owner" && (
                      member.role !== "owner" ? (
                        <button
                          onClick={() => removeMember(id || "", member.user_id)}
                          className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      ) : (
                        <div className="w-4 shrink-0" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Left Drag Handle */}
        {!isLeftCollapsed && !isMobile && (
          <div
            className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-slate-100/50 transition-colors rounded"
            onMouseDown={(e) => handleDragStart("left", e)}
          >
            <div className="w-0.5 h-8 bg-slate-200 group-hover:bg-slate-400 rounded-full transition-colors" />
          </div>
        )}

        {/* Left Toggle */}
        {isLeftCollapsed && !isMobile && (
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
        <section className={`flex-1 bg-white flex-col overflow-hidden relative ${isMobile ? (mobileTab === "chat" ? "flex" : "hidden") : "flex"}`} onPaste={handlePaste}>
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-6 shrink-0">
            <h2 className="text-[13px] font-semibold text-slate-700">Chat</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-8 pb-32">
            <div className="max-w-3xl mx-auto" onClick={handleCitationClick}>
              {/* Notebook Overview */}
              <div className="mb-10 text-center">
                <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Globe className="w-7 h-7 text-blue-500" />
                </div>
                <h1 className="text-[28px] font-bold text-slate-900 mb-2 leading-tight">
                  {notebook?.name || ""}
                </h1>
                <p className="text-[13px] text-slate-500 mb-6">
                  {selectedCount} {selectedCount === 1 ? 'source' : 'sources'} selected
                </p>

                {overview?.overview && (
                  <div className="text-left text-[15px] text-slate-700 leading-relaxed space-y-4 mb-8">
                    <MarkdownContent content={overview.overview} />
                  </div>
                )}

                {overview?.overview && (
                  <div className="flex items-center justify-center gap-3 mt-6">
                    {overviewSaved ? (
                      <span className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-green-200 bg-green-50 text-[13px] font-medium text-green-600">
                        <Check className="w-3.5 h-3.5" /> Saved
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          await handleSaveNote(overview.overview);
                          setOverviewSaved(true);
                        }}
                        className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" /> Save to note
                      </button>
                    )}
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
                  <div key={msg.id} data-message-id={msg.id}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="bg-[#eef1f5] text-slate-800 px-5 py-3 rounded-2xl rounded-tr-sm max-w-[80%] text-[14px]">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="text-slate-800 text-[14px] leading-relaxed max-w-full">
                          <MarkdownContent content={msg.content} />
                          <div className="flex items-center gap-2 mt-4">
                            {savedMessageIds.has(msg.id) ? (
                              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-200 bg-green-50 text-[11px] font-medium text-green-600">
                                <Check className="w-3 h-3" /> Saved
                              </span>
                            ) : (
                              <button
                                onClick={() => handleSaveMessageAsNote(msg)}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-200 text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                              >
                                <BookmarkPlus className="w-3 h-3" /> Save to note
                              </button>
                            )}
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

                {/* Thinking indicator */}
                {isStreaming && isThinkingPhase && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-1.5 bg-purple-50 border border-purple-100 rounded-full px-3 py-1.5 text-[12px] text-purple-600 font-medium">
                      <Brain className="w-3.5 h-3.5 animate-pulse" />
                      Thinking...
                    </div>
                  </div>
                )}

                {/* Streaming bubble */}
                {isStreaming && streamingContent && (
                  <div className="flex justify-start">
                    <div className="text-slate-800 text-[14px] leading-relaxed max-w-full">
                      <MarkdownContent content={streamingContent} />
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
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-10 pb-6 px-8 select-none">
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
                  <button
                    onClick={() => setThinking(!thinking)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      thinking
                        ? "bg-purple-100 text-purple-700 ring-1 ring-purple-300"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    <Brain className="w-3 h-3" />
                    {thinking ? "Thinking" : "Think"}
                  </button>
                  <span className="text-[11px] text-slate-400 font-medium px-2">
                    {selectedCount} {selectedCount === 1 ? 'source' : 'sources'}
                  </span>
                  {isStreaming ? (
                    <button
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors bg-red-600 text-white hover:bg-red-700"
                      onClick={() => stopStream()}
                      title="Stop generating"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        canSend ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-300"
                      }`}
                      disabled={!canSend}
                      onClick={handleSend}
                      title={selectedIds.size === 0 ? "Select at least 1 source to chat" : undefined}
                    >
                      <ArrowLeft className="w-4 h-4 rotate-180" />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-center mt-3 text-[10px] text-slate-400">
                AI can be inaccurate; please double-check its responses.
              </div>
            </div>
          </div>
        </section>

        {/* Right Toggle */}
        {isRightCollapsed && !isMobile && (
          <div className="w-12 flex items-start justify-center pt-4 shrink-0">
            <button
              onClick={() => setIsRightCollapsed(false)}
              className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
            >
              <PanelRightClose className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}

        {/* Right Drag Handle */}
        {!isRightCollapsed && !isMobile && (
          <div
            className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-slate-100/50 transition-colors rounded"
            onMouseDown={(e) => handleDragStart("right", e)}
          >
            <div className="w-0.5 h-8 bg-slate-200 group-hover:bg-slate-400 rounded-full transition-colors" />
          </div>
        )}

        {/* Right Panel: Studio */}
        <section
          style={!isMobile && !isRightCollapsed ? { width: rightWidth } : undefined}
          className={`bg-white border-l border-slate-200 flex-col overflow-hidden shrink-0 relative ${!isDragging ? "transition-all duration-300" : ""} ${isRightCollapsed && !isMobile ? "w-0 border-none" : ""} ${isMobile ? (mobileTab === "studio" ? "flex w-full" : "hidden") : "flex"}`}
        >
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-4 shrink-0 select-none">
            <h2 className="text-[13px] font-semibold text-slate-700">Studio</h2>
            <button
              onClick={() => setIsRightCollapsed(true)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pb-24">
            <div className="grid grid-cols-2 gap-2.5 mb-4 select-none sticky top-0 bg-white z-10 p-4 pb-2">
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

              {/* Action Items */}
              <button
                onClick={() => handleStudioAction("action_items")}
                disabled={isGenerating.action_items}
                className="bg-[#fef9c3] hover:bg-yellow-100 border border-yellow-100 rounded-xl p-3 cursor-pointer transition-colors group relative text-left"
              >
                {isGenerating.action_items ? (
                  <Loader2 className="w-4 h-4 text-yellow-600 mb-2 animate-spin" />
                ) : (
                  <ListChecks className="w-4 h-4 text-yellow-600 mb-2" />
                )}
                <div className="text-[11px] font-bold text-yellow-900">Action Items</div>
              </button>
            </div>

            <div className="px-4">
            {/* PDF / Source Viewer */}
            {pdfViewer && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-bold text-slate-500 tracking-wider truncate flex-1">
                    {pdfViewer.filename}
                    {pdfViewer.page > 1 && (
                      <span className="ml-1 text-slate-400">— Page {pdfViewer.page}</span>
                    )}
                  </h4>
                  <button
                    onClick={closePdf}
                    className="text-slate-400 hover:text-slate-600 transition-colors ml-2 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                  <iframe
                    key={pdfViewer._seq}
                    src={`/api/notebooks/${id}/sources/${pdfViewer.sourceId}/file?token=${api.getToken()}#page=${pdfViewer.page}`}
                    className="w-full h-[500px] border-none"
                    title={pdfViewer.filename}
                  />
                </div>
              </div>
            )}

            {/* Generated Content Display */}
            {(studioContent.summary || studioContent.faq || studioContent.mindmap || studioContent.action_items) && (
              <div className="mb-6 space-y-4">
                {studioContent.summary && (
                  <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-indigo-600">SUMMARY</h4>
                      <button
                        onClick={() => handleMinimizeStudioContent("summary", studioContent.summary, "Summary")}
                        className="text-indigo-400 hover:text-indigo-600 transition-colors p-0.5"
                        title="Save to notes and minimize"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <MarkdownContent
                      content={studioContent.summary}
                      className="text-[13px] text-slate-700 leading-relaxed"
                    />
                  </div>
                )}
                {studioContent.faq && (
                  <div className="p-3 bg-cyan-50 rounded-xl border border-cyan-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-cyan-600">FAQ</h4>
                      <button
                        onClick={() => handleMinimizeStudioContent("faq", studioContent.faq, "FAQ")}
                        className="text-cyan-400 hover:text-cyan-600 transition-colors p-0.5"
                        title="Save to notes and minimize"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <MarkdownContent
                      content={studioContent.faq}
                      className="text-[13px] text-slate-700 leading-relaxed"
                    />
                  </div>
                )}
                {studioContent.mindmap && (
                  <div className="p-3 bg-pink-50 rounded-xl border border-pink-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-pink-600">MIND MAP</h4>
                      <button
                        onClick={() => handleMinimizeStudioContent("mindmap", studioContent.mindmap, "Mind Map")}
                        className="text-pink-400 hover:text-pink-600 transition-colors p-0.5"
                        title="Save to notes and minimize"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <MindMapContent content={studioContent.mindmap} />
                  </div>
                )}
                {studioContent.action_items && (
                  <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-yellow-600">ACTION ITEMS</h4>
                      <button
                        onClick={() => handleMinimizeStudioContent("action_items", studioContent.action_items, "Action Items")}
                        className="text-yellow-500 hover:text-yellow-700 transition-colors p-0.5"
                        title="Save to notes and minimize"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <MarkdownContent
                      content={studioContent.action_items}
                      className="text-[13px] text-slate-700 leading-relaxed"
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
                {notes.map((note) => {
                  const isExpanded = expandedNoteId === note.id;
                  return (
                    <div
                      key={note.id}
                      className="p-3 rounded-xl hover:bg-slate-50 cursor-pointer group transition-colors border border-transparent hover:border-slate-100"
                      onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            {isExpanded ? (
                              <NoteContent
                                content={note.content}
                                className="text-[13px] text-slate-700 leading-relaxed"
                              />
                            ) : (
                              <p className="text-[13px] text-slate-700 leading-snug line-clamp-2">
                                {stripMarkdownToText(note.content)}
                              </p>
                            )}
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {timeAgo(note.created_at)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); id && deleteNote(id, note.id); }}
                          className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {notes.length === 0 && (
                  <p className="text-[12px] text-slate-400 text-center py-4">
                    No saved notes yet
                  </p>
                )}
              </div>
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
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        notebookId={id || ""}
        onMemberAdded={() => {
          if (id) {
            api.getNotebook(id).then(setNotebook).catch(() => {});
            fetchMembers(id);
          }
        }}
      />
      <PptConfigModal
        isOpen={pptModalOpen}
        onClose={() => setPptModalOpen(false)}
        isGenerating={pptLoading}
        onGenerate={async (config: PptConfig) => {
          if (!id) return;
          setPptLoading(true);
          try {
            await api.downloadPPT(id, config);
            setPptModalOpen(false);
          } catch (err) {
            console.error("PPT generation failed:", err);
          } finally {
            setPptLoading(false);
          }
        }}
      />
    </div>
  );
}
