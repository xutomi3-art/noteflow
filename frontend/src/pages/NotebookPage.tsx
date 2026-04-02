import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  GripVertical,
  ListChecks,
  MessageSquare,
  Sparkles,
  Minimize2,
  Square,
  Upload,
  Link as LinkIcon,
  ChevronRight,
  ChevronUp,
  Bug,
  Shield,
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
import FeedbackModal from "@/components/FeedbackModal";
import PptConfigModal from "@/components/PptConfigModal";
import type { PptConfig } from "@/components/PptConfigModal";
import MarkdownContent from "@/components/MarkdownContent";
import MindMap from "@/components/MindMap";
import { useMeetingStore } from "@/features/meeting/meeting-store";
import { MeetingPanel } from "@/features/meeting/MeetingPanel";

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

function statusLabel(status: Source["status"], progress?: number | null): string {
  if (status === "uploading") return "Uploading...";
  if (status === "parsing" || status === "vectorizing") {
    if (progress != null && progress > 0) return `Processing ${progress.toFixed(1)}%`;
    return "Processing...";
  }
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
  const pendingOverviewRef = useRef<{ overview: string; suggested_questions: string[] } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
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
  const [showHotwords, setShowHotwords] = useState(false);
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [hotwordInput, setHotwordInput] = useState("");
  const [renamingSourceId, setRenamingSourceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sourceMenuId, setSourceMenuId] = useState<string | null>(null);

  // Close source menu on outside click
  useEffect(() => {
    if (!sourceMenuId) return;
    const handler = () => setSourceMenuId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [sourceMenuId]);

  // Load hotwords from API on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/api/notebooks/${id}/meetings/hotwords`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
    })
      .then((r) => r.json())
      .then((d) => setHotwords(d.words || []))
      .catch(() => {});
  }, [id]);

  const saveHotwords = useCallback(
    (words: string[]) => {
      if (!id) return;
      setHotwords(words);
      fetch(`/api/notebooks/${id}/meetings/hotwords`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ words }),
      }).catch(() => {});
    },
    [id],
  );
  const profileHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);
  const [isDragging, setIsDragging] = useState(false);
  const [showMeetingPanel, setShowMeetingPanel] = useState(false);
  const [pendingResumeMeeting, setPendingResumeMeeting] = useState<any>(null);
  const meetingActive = useMeetingStore((s) => s.activeMeeting !== null && s.activeMeeting.notebook_id === id);

  // Check for active meeting on page load (e.g. after refresh)
  // Skip check for 5s after ending a meeting to avoid false "interrupted" prompt
  const meetingEndedAtRef = useRef(0);
  useEffect(() => {
    if (!id || meetingActive) return;
    if (Date.now() - meetingEndedAtRef.current < 5000) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    fetch(`/api/notebooks/${id}/meetings/active`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : null).then(meeting => {
      if (meeting && meeting.status === "recording" && Date.now() - meetingEndedAtRef.current > 5000) {
        // Only show resume for the meeting creator; others just see info
        if (meeting.created_by === user?.id) {
          setPendingResumeMeeting(meeting);
        }
        // TODO: could show "Someone is recording..." banner for other users
      }
    }).catch(() => {});
  }, [id, meetingActive]);

  // Auto-widen source panel during meeting
  const effectiveLeftWidth = showMeetingPanel ? Math.max(leftWidth, 420) : leftWidth;
  const [isMobile, setIsMobile] = useState(false);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [overviewSaved, setOverviewSaved] = useState(false);
  const [copiedMessageIds, setCopiedMessageIds] = useState<Set<string>>(new Set());
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down' | null>>({});
  const [feedbackMsgId, setFeedbackMsgId] = useState<string | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [modalFiles, setModalFiles] = useState<File[]>([]);
  const [modalUrls, setModalUrls] = useState<string[]>([]);
  const [modalUrlInput, setModalUrlInput] = useState("");
  const [modalUrlError, setModalUrlError] = useState<string | null>(null);
  const modalFileInputRef = useRef<HTMLInputElement>(null);
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
  const { sources, selectedIds, toggleSelect, selectAll, deselectAll, fetchSources, uploadSource, deleteSource, subscribeStatus, cleanup, activeSourceId, activeSourceContent, isLoadingContent, setActiveSource, clearActiveSource, highlightExcerpt, highlightSeq, raptorStatus } =
    useSourceStore();
  const { messages, isStreaming, streamingContent, fetchHistory, sendMessage, stopStream, clearHistory, deepThinking, setDeepThinking, thinkingSteps, reset: resetChat } = useChatStore();
  const {
    content: studioContent,
    isGenerating,
    notes,
    pdfViewer,
    openPdf,
    generateContent,
    clearContent,
    fetchNotes,
    deleteNote,
    closePdf,
    reset: resetStudio,
  } = useStudioStore();
  const { members, fetchMembers, removeMember } = useSharingStore();

  // Auto-expand Studio panel when new content appears
  const prevContentCountRef = useRef(0);
  useEffect(() => {
    const contentCount = Object.values(studioContent).filter(v => v && typeof v === "string" && v.length > 0).length;
    if (contentCount > prevContentCountRef.current && !isRightCollapsed) {
      setRightWidth(w => Math.max(w, Math.min(520, window.innerWidth * 0.35)));
    }
    prevContentCountRef.current = contentCount;
  }, [studioContent, isRightCollapsed]);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRenameSource = useCallback(async (sourceId: string, newName: string) => {
    if (!id || !newName.trim()) return;
    try {
      await api.renameSource(id, sourceId, newName.trim());
      fetchSources(id);
    } catch (e) {
      console.error("Rename failed:", e);
    }
    setRenamingSourceId(null);
  }, [id, fetchSources]);

  // Derived
  const readySources = sources.filter((s) => s.status === "ready");
  const selectedCount = selectedIds.size;
  const isAllSelected = readySources.length > 0 && readySources.every((s) => selectedIds.has(s.id));
  const hasProcessingSelected = sources.some((s) => selectedIds.has(s.id) && isProcessingStatus(s.status));
  const hasSharedChat = notebook?.shared_chat && messages.length > 0;
  const canSend = chatInput.trim().length > 0 && !isStreaming && !hasProcessingSelected && (readySources.length > 0 && selectedIds.size > 0 || meetingActive || hasSharedChat);

  // Data loading — verify access FIRST, then load data
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    // Reset state immediately so stale data from a previous notebook is never shown
    setNotebook(null);
    setNotFound(false);
    setOverview(null);

    api.getNotebook(id).then((nb) => {
      if (cancelled) return;
      setNotebook(nb);
      if (nb.is_shared) fetchMembers(id);
      // Only load data after permission check passes
      fetchSources(id);
      subscribeStatus(id);
      fetchHistory(id);
      fetchNotes(id);
      api.getOverview(id).then(data => {
        if (!cancelled && data.overview) {
          // Defer overview update if chat is streaming to avoid interrupting SSE
          if (useChatStore.getState().isStreaming) {
            pendingOverviewRef.current = data;
          } else {
            setOverview(data);
          }
        }
      }).catch(() => {});
    }).catch(() => {
      if (!cancelled) setNotFound(true);
    });

    return () => {
      cancelled = true;
      cleanup();
      resetChat();
      resetStudio();
      setSavedMessageIds(new Set());
      setOverviewSaved(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Polling fallback: refetch sources every 30s while any are processing (SSE may drop)
  useEffect(() => {
    if (!id) return;
    const hasProcessing = sources.some((s) => s.status !== "ready" && s.status !== "failed");
    if (!hasProcessing) return;
    const timer = setInterval(() => fetchSources(id), 30000);
    return () => clearInterval(timer);
  }, [id, sources, fetchSources]);

  // Re-fetch notebook on window focus so role/permission changes are reflected without refresh
  useEffect(() => {
    if (!id) return;
    const onFocus = () => {
      api.getNotebook(id).then((nb) => {
        setNotebook(nb);
      }).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
      // Upload files (use api.uploadSource with AbortController + progress)
      for (let i = 0; i < files.length; i++) {
        const uploadId = fileIds[i];
        const controller = new AbortController();
        uploadControllersRef.current.set(uploadId, controller);
        try {
          const uploaded = await api.uploadSource(id, files[i], controller.signal, (progress) => {
            setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress } : u));
          });
          fetchSources(id);
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Warn before page unload if uploads are in progress
  const hasActiveUploads = pendingUploads.some(u => u.status === 'uploading');
  useEffect(() => {
    if (!hasActiveUploads) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasActiveUploads]);

  // Remove pending uploads whose linked source has reached "ready" status
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const readySourceIds = new Set(sources.filter(s => s.status === 'ready').map(s => s.id));
    const hasReady = pendingUploads.some(u => u.sourceId && readySourceIds.has(u.sourceId));
    if (hasReady) {
      setPendingUploads(prev => prev.filter(u => !u.sourceId || !readySourceIds.has(u.sourceId)));
    }
  }, [sources, pendingUploads]);

  // Re-fetch overview when sources finish processing
  const readyCount = sources.filter(s => s.status === "ready").length;
  const prevReadyRef = useRef(0);
  const allSourcesDone = sources.length > 0 && sources.every(s => s.status === "ready" || s.status === "failed");
  const prevAllDoneRef = useRef(false);
  useEffect(() => {
    if (!id || readyCount === 0) return;
    // Fetch when readyCount increases and we have no overview yet
    const shouldFetch =
      (readyCount > prevReadyRef.current && !overview) ||
      (allSourcesDone && !prevAllDoneRef.current);
    if (shouldFetch) {
      api.getOverview(id).then(data => {
        if (data.overview) {
          if (useChatStore.getState().isStreaming) {
            pendingOverviewRef.current = data;
          } else {
            setOverview(data);
          }
        }
      }).catch(() => {});
    }
    prevReadyRef.current = readyCount;
    prevAllDoneRef.current = allSourcesDone;
  }, [id, readyCount, allSourcesDone, overview]);

  // Apply pending overview after streaming ends (deferred to avoid interrupting SSE)
  useEffect(() => {
    if (!isStreaming && pendingOverviewRef.current) {
      setOverview(pendingOverviewRef.current);
      pendingOverviewRef.current = null;
    }
  }, [isStreaming]);

  // Auto-scroll chat — only if user is near the bottom
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);
  // Reset scroll lock when streaming ends
  useEffect(() => {
    if (!streamingContent) {
      userScrolledUpRef.current = false;
    }
  }, [streamingContent]);

  // Highlight is now handled by the ref callback on the source content div (see JSX below)

  // Handlers
  const handleSend = useCallback(() => {
    if (!id || !canSend) return;
    sendMessage(id, chatInput.trim(), [...selectedIds], webSearchEnabled, deepThinking);
    setChatInput("");
  }, [id, canSend, chatInput, selectedIds, sendMessage, webSearchEnabled, deepThinking]);

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

  const [maxFileSizeMB, setMaxFileSizeMB] = useState(200);
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(d => setMaxFileSizeMB(d.max_file_size_mb || 200)).catch(() => {}); }, []);
  const MAX_FILE_SIZE = maxFileSizeMB * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set([
    'pdf', 'docx', 'pptx', 'txt', 'md',
    'xlsx', 'xls', 'csv',
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp',
  ]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!id || !e.target.files) return;
      const files = Array.from(e.target.files);
      const rejectedType: string[] = [];
      const rejectedSize: string[] = [];
      const accepted: File[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          rejectedType.push(file.name);
        } else if (file.size > MAX_FILE_SIZE) {
          rejectedSize.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
        } else {
          accepted.push(file);
        }
      }
      const messages: string[] = [];
      if (rejectedType.length > 0) {
        messages.push(`Unsupported file type:\n${rejectedType.join('\n')}\n\nSupported: pdf, docx, pptx, txt, md, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp`);
      }
      if (rejectedSize.length > 0) {
        messages.push(`Exceeds ${maxFileSizeMB} MB limit:\n${rejectedSize.join('\n')}`);
      }
      if (messages.length > 0) {
        alert(messages.join('\n\n'));
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
    let normalizedUrl = urlInput.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = "https://" + normalizedUrl;
    try { new URL(normalizedUrl); } catch {
      setUrlError("请输入有效的域名或网址");
      return;
    }
    setIsAddingUrl(true);
    setUrlError(null);
    try {
      await api.addUrlSource(id, normalizedUrl);
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

  // ─── Add Source Modal helpers ───
  const closeAddSourceModal = useCallback(() => {
    setShowAddSourceModal(false);
    setModalFiles([]);
    setModalUrls([]);
    setModalUrlInput("");
    setModalUrlError(null);
  }, []);

  const handleModalFilesSelected = useCallback((files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const rejectedType: string[] = [];
    const rejectedSize: string[] = [];
    const accepted: File[] = [];
    for (const file of newFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        rejectedType.push(file.name);
      } else if (file.size > MAX_FILE_SIZE) {
        rejectedSize.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        accepted.push(file);
      }
    }
    const messages: string[] = [];
    if (rejectedType.length > 0) {
      messages.push(`Unsupported file type:\n${rejectedType.join('\n')}\n\nSupported: pdf, docx, pptx, txt, md, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp`);
    }
    if (rejectedSize.length > 0) {
      messages.push(`Exceeds ${maxFileSizeMB} MB limit:\n${rejectedSize.join('\n')}`);
    }
    if (messages.length > 0) alert(messages.join('\n\n'));
    if (accepted.length > 0) setModalFiles(prev => [...prev, ...accepted]);
  }, []);

  const handleModalAddUrl = useCallback(() => {
    let url = modalUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch {
      setModalUrlError('请输入有效的域名或网址');
      return;
    }
    if (modalUrls.includes(url)) { setModalUrlInput(''); setModalUrlError(null); return; }
    setModalUrls(prev => [...prev, url]);
    setModalUrlInput('');
    setModalUrlError(null);
  }, [modalUrlInput, modalUrls]);

  const handleModalSubmit = useCallback(async () => {
    if (!id || (modalFiles.length === 0 && modalUrls.length === 0)) return;

    // Start file uploads
    const filesToUpload = [...modalFiles];
    const urlsToAdd = [...modalUrls];

    // Create pending upload entries BEFORE closing modal so there's no blank gap
    const allPendingUploads: typeof pendingUploads = [];
    const fileUploadIds: number[] = [];
    if (filesToUpload.length > 0) {
      const uploadIds = filesToUpload.map(() => ++uploadIdCounterRef.current);
      fileUploadIds.push(...uploadIds);
      allPendingUploads.push(...filesToUpload.map((f, i) => ({ id: uploadIds[i], name: f.name, status: 'uploading' as const, progress: 0 })));
    }
    const urlUploadIds: number[] = [];
    if (urlsToAdd.length > 0) {
      const ids = urlsToAdd.map(() => ++uploadIdCounterRef.current);
      urlUploadIds.push(...ids);
      allPendingUploads.push(...urlsToAdd.map((u, i) => ({ id: ids[i], name: u, status: 'uploading' as const, progress: 0 })));
    }
    if (allPendingUploads.length > 0) {
      setPendingUploads(prev => [...prev, ...allPendingUploads]);
    }

    closeAddSourceModal();

    // Upload files
    if (filesToUpload.length > 0) {
      for (let i = 0; i < filesToUpload.length; i++) {
        const controller = new AbortController();
        const uploadId = fileUploadIds[i];
        uploadControllersRef.current.set(uploadId, controller);
        try {
          const uploaded = await api.uploadSource(id, filesToUpload[i], controller.signal, (progress) => {
            setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress } : u));
          });
          fetchSources(id);
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
      setTimeout(() => setPendingUploads(prev => prev.filter(u => u.status === 'uploading' || u.status === 'processing')), 2000);
    }

    // Add URLs
    if (urlsToAdd.length > 0) {
      for (let i = 0; i < urlsToAdd.length; i++) {
        const uploadId = urlUploadIds[i];
        try {
          const uploaded = await api.addUrlSource(id, urlsToAdd[i]);
          fetchSources(id);
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'processing' as const, progress: 100, sourceId: uploaded.id } : u));
        } catch {
          setPendingUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'error' as const } : u));
        }
      }
      setTimeout(() => setPendingUploads(prev => prev.filter(u => u.status === 'uploading' || u.status === 'processing')), 2000);
    }
  }, [id, modalFiles, modalUrls, closeAddSourceModal, fetchSources]);

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
    async (msg: ChatMessage) => {
      await handleSaveNote(msg.content);
      setSavedMessageIds((prev) => new Set(prev).add(msg.id));
    },
    [handleSaveNote],
  );

  const handleCopyMessage = useCallback((msgId: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedMessageIds((prev) => new Set([...prev, msgId]));
    setTimeout(() => {
      setCopiedMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }, 2000);
  }, []);

  const handleMessageFeedback = useCallback((msgId: string, vote: 'up' | 'down') => {
    const newVote = messageFeedback[msgId] === vote ? null : vote;
    setMessageFeedback((prev) => ({
      ...prev,
      [msgId]: newVote,
    }));
    if (newVote === 'down') {
      setFeedbackMsgId(msgId);
      setFeedbackComment("");
    } else {
      setFeedbackMsgId(null);
      setFeedbackComment("");
      if (id) {
        api.submitChatFeedback(id, msgId, newVote || "none").catch(() => {});
      }
    }
  }, [id, messageFeedback]);

  const handleSubmitFeedbackComment = useCallback(() => {
    if (!id || !feedbackMsgId) return;
    api.submitChatFeedback(id, feedbackMsgId, "down", feedbackComment || undefined).catch(() => {});
    setFeedbackMsgId(null);
    setFeedbackComment("");
  }, [id, feedbackMsgId, feedbackComment]);

  const handleCopyToClipboard = useCallback((text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
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

      // For mindmap, save raw JSON so NoteContent renders it as MindMapTreeView
      if (contentType === "mindmap") {
        let raw = content.trim();
        if (raw.startsWith("```")) {
          raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        noteContent = raw;
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
        await generateContent(id, action, Array.from(selectedIds));
      }
    },
    [id, generateContent, selectedIds],
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
              alert(`Pasted image (${(file.size / 1024 / 1024).toFixed(1)} MB) exceeds the ${maxFileSizeMB} MB limit.`);
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

  /** Build a flat map of citation index → {source_id, excerpt} from all messages */
  const citationMap = useMemo(() => {
    const map = new Map<number, { source_id: string; filename: string; excerpt: string }>();
    for (const msg of messages) {
      if (msg.citations) {
        for (const c of msg.citations) {
          if (!map.has(c.index)) {
            map.set(c.index, { source_id: c.source_id || "", filename: c.filename || "", excerpt: c.excerpt || "" });
          }
        }
      }
    }
    return map;
  }, [messages]);

  /** Handle citation badge click — open source content viewer in left panel with highlighted excerpt */
  const handleCitationClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const badge = target.closest(".citation-badge") as HTMLElement | null;
      if (!badge) return;

      const citationIndex = parseInt(badge.dataset.citationIndex || "", 10);
      if (isNaN(citationIndex)) return;

      // Look up citation from pre-built map (no DOM traversal needed)
      const citation = citationMap.get(citationIndex);

      // Resolve source_id
      const currentSources = useSourceStore.getState().sources;
      let sourceId = citation?.source_id || "";
      if (!sourceId && citation?.filename) {
        const citStem = citation.filename.replace(/\.[^.]+$/, "").toLowerCase();
        const matched = currentSources.find((s) => {
          const sStem = s.filename.replace(/\.[^.]+$/, "").toLowerCase();
          return sStem === citStem || s.filename.toLowerCase() === citation.filename.toLowerCase()
            || sStem.includes(citStem) || citStem.includes(sStem);
        });
        if (matched) sourceId = matched.id;
      }
      if (!sourceId) {
        const readySources = currentSources.filter(s => s.status === "ready");
        if (readySources.length > 0) sourceId = readySources[0].id;
      }
      if (!sourceId) return;

      const excerpt = citation?.excerpt || null;
      if (id) {
        setActiveSource(id, sourceId, excerpt);
        setIsLeftCollapsed(false);
      }

      // Highlight: poll DOM directly (not via ref) until content renders
      if (excerpt) {
        let tries = 0;
        const pollHL = () => {
          // Find the source content container directly in DOM
          const el = document.querySelector("[data-source-content]") as HTMLElement | null;
          if (!el || !el.textContent || el.textContent.length < 100) {
            if (tries++ < 30) setTimeout(pollHL, 300);
            return;
          }
          // Clean old highlights
          el.querySelectorAll("mark.citation-highlight").forEach((m) => {
            const p = m.parentNode; if (p) { p.replaceChild(document.createTextNode(m.textContent || ""), m); p.normalize(); }
          });
          const strip = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
          const fullKey = strip(el.textContent);
          // Strip HTML tags, image markdown ![](url), page markers, heading markers, and broken comment fragments
          const cleanExcerpt = excerpt!
            .replace(/<[^>]+>/g, "")              // HTML tags
            .replace(/!\[.*?\]\([^)]*\)/g, "")    // image markdown
            .replace(/<!--[^>]*-->/g, "")         // HTML comments
            .replace(/^#{1,6}\s+/gm, "")          // heading markers
            .replace(/page:\d+\s*-->/g, "")       // broken comment fragments like " page:153 -->"
            .replace(/<!--\s*/g, "");             // orphan comment opens
          const excKey = strip(cleanExcerpt);
          let idx = -1;
          // Try full match first, then progressively shorter prefixes from the START
          for (const len of [excKey.length, 200, 100, 70, 50, 30]) {
            const needle = len >= excKey.length ? excKey : excKey.slice(0, len);
            idx = fullKey.indexOf(needle);
            if (idx !== -1) break;
          }
          if (idx === -1) return;
          const raw = el.textContent;
          const isC = (c: string) => /[\p{L}\p{N}]/u.test(c);
          let ri = 0, ki = 0;
          while (ri < raw.length && ki < idx) { if (isC(raw[ri])) ki++; ri++; }
          while (ri < raw.length && !isC(raw[ri])) ri++;
          let re = ri, ek = 0;
          while (re < raw.length && ek < excKey.length) { if (isC(raw[re])) ek++; re++; }
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const nodes: { node: Text; start: number }[] = [];
          let full = ""; let tn: Text | null;
          while ((tn = walker.nextNode() as Text | null)) { nodes.push({ node: tn, start: full.length }); full += tn.textContent || ""; }
          let first: HTMLElement | null = null;
          for (const { node, start } of nodes) {
            const nLen = node.textContent?.length || 0;
            if (start + nLen <= ri || start >= re) continue;
            const ls = Math.max(0, ri - start), le = Math.min(nLen, re - start);
            if (ls >= le) continue;
            try {
              const r = document.createRange(); r.setStart(node, ls); r.setEnd(node, le);
              const m = document.createElement("mark"); m.className = "citation-highlight";
              m.style.cssText = "background:#fef08a;padding:2px 0;border-radius:2px;scroll-margin-top:80px";
              r.surroundContents(m); if (!first) first = m;
            } catch { /* cross-element */ }
          }
          if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
        };
        setTimeout(pollHL, 500);
      }
    },
    [id, setActiveSource, citationMap],
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

  // Show loading while permission check is in progress — prevents flash of notebook content.
  // Check notebook.id matches URL id to prevent stale data flash on client-side navigation
  // (useEffect runs AFTER render, so stale notebook from previous route would flash for one frame).
  if (!notebook || notebook.id !== id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0f2f5] font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#5b8c15] border-t-transparent" />
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
          <span className="px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#5b8c15]/10 text-[#5b8c15] rounded -ml-1">Alpha</span>
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
          <button
            onClick={() => navigate("/dashboard")}
            className="p-1.5 bg-[#ecfccb] text-[#5b8c15] hover:bg-[#d9f99d] rounded-lg transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
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
          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="Report Bug & Make a Wish"
          >
            <Bug className="w-4 h-4" />
          </button>
          <div className="text-right hidden md:block">
            <div className="font-semibold text-sm">{user?.name || "User"}</div>
            <div className="text-xs text-slate-500">{user?.email}</div>
          </div>
          <div
            className="relative"
            onMouseEnter={() => {
              if (profileHoverRef.current) clearTimeout(profileHoverRef.current);
              setIsProfileMenuOpen(true);
            }}
            onMouseLeave={() => {
              profileHoverRef.current = setTimeout(() => setIsProfileMenuOpen(false), 500);
            }}
          >
            <button className="w-9 h-9 rounded-full bg-[#5b8c15] text-white flex items-center justify-center font-bold text-sm hover:bg-[#4a7311] transition-colors">
              {(user?.name || "U").charAt(0).toUpperCase()}
            </button>
            {isProfileMenuOpen && (
              <div className="absolute top-full right-0 pt-2 w-48 z-20">
                <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 py-2">
                  {user?.is_admin && (
                    <button
                      onClick={() => { setIsProfileMenuOpen(false); navigate('/admin'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                    >
                      <Shield className="w-4 h-4" />
                      Admin
                    </button>
                  )}
                  <button
                    onClick={() => { setIsProfileMenuOpen(false); setShowHotwords(true); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 font-medium transition-colors"
                  >
                    <Mic className="w-4 h-4" />
                    Hotwords
                  </button>
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
          style={!isMobile && !isLeftCollapsed ? { width: effectiveLeftWidth } : undefined}
          className={`bg-white border-r border-slate-200 flex-col overflow-hidden shrink-0 transition-all duration-300 ${isLeftCollapsed && !isMobile ? "w-0 border-none" : ""} ${isMobile ? (mobileTab === "sources" ? "flex w-full" : "hidden") : "flex"}`}
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

          {raptorStatus === "running" && (
            <div className="px-4 py-2 border-b border-slate-100 bg-amber-50/50">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                <span className="text-[11px] font-medium text-amber-700">Indexing knowledge base...</span>
              </div>
              <div className="mt-1.5 h-1 bg-amber-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            </div>
          )}
          {raptorStatus === "done" && (
            <div className="px-4 py-2 border-b border-slate-100 bg-emerald-50/50">
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                <span className="text-[11px] font-medium text-emerald-700">Indexing complete</span>
              </div>
            </div>
          )}

          {/* Meeting Panel — shown when meeting is active */}
          {showMeetingPanel && meetingActive ? (
            <MeetingPanel onClose={() => { meetingEndedAtRef.current = Date.now(); setShowMeetingPanel(false); setPendingResumeMeeting(null); }} />
          ) : activeSourceId ? (
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
                  <div data-source-content ref={sourceContentRef}>
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
              <button
                onClick={() => setShowAddSourceModal(true)}
                className="w-full flex flex-col items-center justify-center gap-1 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-center cursor-pointer hover:border-[#5b8c15]/40 hover:bg-slate-50/50 transition-colors mb-4"
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
              </button>
            )}

            {/* Meeting: recording banner (when panel is hidden but meeting active) */}
            {!showMeetingPanel && meetingActive && (
              <button
                onClick={() => setShowMeetingPanel(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 mb-4 rounded-xl bg-red-50 border border-red-200 transition-colors hover:bg-red-100"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-[12px] font-medium text-red-600">Meeting recording...</span>
                </div>
                <span className="text-[11px] text-red-400">View →</span>
              </button>
            )}

            {/* Resume interrupted meeting banner */}
            {pendingResumeMeeting && !meetingActive && (
              <div className="w-full mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-[12px] font-medium text-amber-700 mb-2">Meeting was interrupted. Resume recording?</p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        setShowMeetingPanel(true);
                        await useMeetingStore.getState().resumeExistingMeeting(id!, pendingResumeMeeting);
                        setPendingResumeMeeting(null);
                      } catch { setShowMeetingPanel(false); }
                    }}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#5b8c15] text-white hover:bg-[#4a7512]"
                  >
                    Resume
                  </button>
                  <button
                    onClick={async () => {
                      // End the meeting
                      const token = localStorage.getItem("access_token");
                      await fetch(`/api/notebooks/${id}/meetings/${pendingResumeMeeting.id}/end`, {
                        method: "POST", headers: { Authorization: `Bearer ${token}` },
                      }).catch(() => {});
                      setPendingResumeMeeting(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                  >
                    End meeting
                  </button>
                </div>
              </div>
            )}

            {/* New Meeting button (only when no meeting active) */}
            {notebook?.user_role !== "viewer" && !meetingActive && !pendingResumeMeeting && (
              <button
                onClick={async () => {
                  if (!id) return;
                  try {
                    setShowMeetingPanel(true);
                    // End any existing recording in another notebook first
                    const store = useMeetingStore.getState();
                    if (store.activeMeeting && store.activeMeeting.notebook_id !== id) {
                      await store.endMeeting();
                      store.reset();
                    }
                    await useMeetingStore.getState().startMeeting(id);
                  } catch {
                    setShowMeetingPanel(false);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-4 rounded-xl border border-[#5b8c15]/30 text-[#5b8c15] hover:bg-[#5b8c15]/5 transition-colors text-[13px] font-medium"
              >
                <Mic className="w-4 h-4" />
                New Meeting
              </button>
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
                const processingLabel = linkedSource ? statusLabel(linkedSource.status, linkedSource.progress) : null;
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
                        <p className="text-[11px] text-[#5b8c15] font-medium">Uploading {upload.progress}%</p>
                      )}
                      {upload.status === 'processing' && processingLabel && (
                        <p className="text-[11px] text-amber-500 font-medium">{processingLabel}</p>
                      )}
                      {upload.status === 'cancelled' && (
                        <p className="text-[11px] text-slate-400">cancelled</p>
                      )}
                    </div>
                    {(upload.status === 'uploading' || upload.status === 'error') && (
                      <button
                        onClick={() => {
                          const controller = uploadControllersRef.current.get(upload.id);
                          if (controller) {
                            controller.abort();
                          } else {
                            // No controller (stale or already finished) — just remove from list
                            setPendingUploads(prev => prev.filter(u => u.id !== upload.id));
                          }
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
                    {renamingSourceId === source.id ? (
                      <input
                        autoFocus
                        className="text-[13px] w-full bg-white border border-[#5b8c15] rounded px-1 py-0.5 outline-none"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameSource(source.id, renameValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSource(source.id, renameValue);
                          if (e.key === "Escape") setRenamingSourceId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p
                        className={`text-[13px] truncate ${isProcessingStatus(source.status) ? "text-slate-400 italic" : source.status === "failed" ? "text-red-500" : "text-slate-700 hover:text-[#5b8c15]"}`}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingSourceId(source.id);
                          setRenameValue(source.filename);
                        }}
                      >
                        {source.filename}
                      </p>
                    )}
                    {isProcessingStatus(source.status) && (
                      <span className="text-[10px] text-amber-500 font-medium">
                        {statusLabel(source.status, source.progress)}
                      </span>
                    )}
                    {source.status === "failed" && (
                      <span className="text-[10px] text-red-500 font-medium">
                        {source.error_message || "Failed"}
                      </span>
                    )}
                  </div>
                  {notebook?.user_role !== "viewer" && (
                    <div className="relative shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourceMenuId(sourceMenuId === source.id ? null : source.id);
                        }}
                        className="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-all p-0.5"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {sourceMenuId === source.id && (
                        <div
                          className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-30"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="w-full text-left px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSourceMenuId(null);
                              setRenamingSourceId(source.id);
                              setRenameValue(source.filename);
                            }}
                          >
                            <Edit3 className="w-3 h-3" />
                            Rename
                          </button>
                          <button
                            className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50 flex items-center gap-2"
                            onClick={(e) => {
                              setSourceMenuId(null);
                              handleDeleteSource(e, source.id);
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
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
            <div className="border-t border-slate-100 px-4 py-3 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                  Team ({members.length})
                </h3>
                {(notebook?.user_role === 'owner' || notebook?.user_role === 'editor') && (
                  <button
                    onClick={() => setIsShareModalOpen(true)}
                    className="text-[12px] text-[#5b8c15] hover:text-[#4a7311] font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Invite
                  </button>
                )}
              </div>
              <div className="space-y-1 overflow-y-auto flex-1">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-2 py-1.5 group"
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                      member.status === "pending"
                        ? "bg-slate-200 text-slate-500"
                        : "bg-[#5b8c15] text-white"
                    }`}>
                      {(member.name || member.email || "U").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] truncate ${
                        member.status === "pending" ? "text-slate-400 italic" : "text-slate-700 font-medium"
                      }`}>
                        {member.name || member.email}
                      </div>
                      {member.email && member.name && (
                        <div className="text-[10px] text-slate-400 truncate">{member.email}</div>
                      )}
                    </div>
                    {member.status === "pending" ? (
                      <span className="text-[10px] text-amber-500 font-medium shrink-0">Pending</span>
                    ) : (
                      <span className="text-[10px] text-slate-400 capitalize shrink-0">{member.role}</span>
                    )}
                    {(notebook?.user_role === "owner" || notebook?.user_role === "editor") && (
                      member.role !== "owner" ? (
                        <button
                          onClick={() => removeMember(id || "", member.user_id)}
                          className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
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
        <section className={`flex-1 bg-white flex-col overflow-hidden relative ${isMobile ? (mobileTab === "chat" ? "flex" : "hidden") : "flex"}`}>
          <div className="h-12 border-b border-slate-100 flex items-center justify-between px-6 shrink-0">
            <h2 className="text-[13px] font-semibold text-slate-700">Chat</h2>
            {messages.length > 0 && (
              <div className="relative">
                {showClearConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Clear chat?</span>
                    <button
                      className="text-[11px] font-medium text-red-600 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50"
                      onClick={() => { if (id) { clearHistory(id); setShowClearConfirm(false); } }}
                    >
                      Yes
                    </button>
                    <button
                      className="text-[11px] font-medium text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-100"
                      onClick={() => setShowClearConfirm(false)}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded hover:bg-slate-100"
                    onClick={() => setShowClearConfirm(true)}
                    title="Clear chat history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-8 pb-32"
            onScroll={() => {
              const el = chatScrollRef.current;
              if (!el) return;
              // User scrolled up if they're more than 150px from bottom
              const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              userScrolledUpRef.current = distFromBottom > 150;
            }}
          >
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
                  <div key={msg.id} data-message-id={msg.id} data-citations={msg.citations?.length ? btoa(encodeURIComponent(JSON.stringify(msg.citations))) : undefined}>
                    {msg.role === "user" ? (
                      <div className={`flex ${msg.user_name && msg.user_id !== user?.id ? "justify-start" : "justify-end"}`}>
                        <div className={`${msg.user_name && msg.user_id !== user?.id ? "bg-blue-50 text-slate-800 rounded-2xl rounded-tl-sm" : "bg-[#eef1f5] text-slate-800 rounded-2xl rounded-tr-sm"} px-5 py-3 max-w-[80%] text-[14px]`}>
                          {msg.user_name && msg.user_id !== user?.id && (
                            <div className="text-[11px] font-semibold text-blue-600 mb-1">{msg.user_name}</div>
                          )}
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
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                              className={`p-1.5 rounded-full transition-colors ${copiedMessageIds.has(msg.id) ? "text-green-600 bg-green-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}
                              title="Copy"
                            >
                              {copiedMessageIds.has(msg.id) ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleMessageFeedback(msg.id, 'up')}
                              className={`p-1.5 rounded-full transition-colors ${messageFeedback[msg.id] === 'up' ? "text-green-600 bg-green-50" : "text-slate-400 hover:text-green-600 hover:bg-green-50"}`}
                              title="Helpful"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMessageFeedback(msg.id, 'down')}
                              className={`p-1.5 rounded-full transition-colors ${messageFeedback[msg.id] === 'down' ? "text-red-500 bg-red-50" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}
                              title="Not helpful"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {feedbackMsgId === msg.id && (
                            <div className="mt-2 p-3 bg-red-50/50 rounded-xl border border-red-100">
                              <p className="text-xs text-slate-500 mb-1.5">What would be the correct answer?</p>
                              <textarea
                                value={feedbackComment}
                                onChange={(e) => setFeedbackComment(e.target.value)}
                                placeholder="Enter the expected answer (optional)..."
                                className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-300 focus:border-red-300"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button
                                  onClick={() => { setFeedbackMsgId(null); setFeedbackComment(""); }}
                                  className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleSubmitFeedbackComment}
                                  className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600"
                                >
                                  Submit
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* ReAct Thinking Steps */}
                {isStreaming && thinkingSteps.length > 0 && (
                  <div className="flex justify-start mb-3">
                    <div className="w-full max-w-full">
                      <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600">
                          <Sparkles className="w-3.5 h-3.5" />
                          Deep Thinking
                        </div>
                        {thinkingSteps.map((step, i) => (
                          <div key={i} className="text-[12px] leading-relaxed">
                            {step.type === "thinking" && (
                              <div className="text-purple-700">
                                <span className="font-medium text-purple-500">Thought {step.step}:</span>{" "}
                                {step.thought}
                              </div>
                            )}
                            {step.type === "searching" && (
                              <div className="text-blue-600 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span className="font-medium">Searching:</span> {step.query}
                              </div>
                            )}
                            {step.type === "observation" && (
                              <div className="text-slate-500">
                                Found {step.found} results ({step.new} new)
                              </div>
                            )}
                          </div>
                        ))}
                        {!streamingContent && (
                          <div className="flex items-center gap-1 text-[11px] text-purple-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Reasoning...
                          </div>
                        )}
                      </div>
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
                {isStreaming && !streamingContent && thinkingSteps.length === 0 && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-[11px] text-slate-400 ml-1">
                        {selectedIds.size > 10
                          ? `${selectedIds.size} sources selected — selecting fewer sources gives faster, more focused answers.`
                          : sources.some(s => selectedIds.has(s.id) && ['xlsx', 'xls', 'csv'].includes(s.file_type))
                            ? 'Analyzing spreadsheet data, this may take a moment...'
                            : ''}
                      </span>
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
                  hasProcessingSelected || (readySources.length === 0 && !meetingActive)
                    ? "border-slate-100 bg-slate-50/50"
                    : "border-slate-200 focus-within:ring-2 focus-within:ring-[#5b8c15]/20 focus-within:border-[#5b8c15]"
                }`}
              >
                <input
                  type="text"
                  placeholder={
                    meetingActive
                      ? "Ask about the meeting..."
                      : readySources.length === 0
                        ? "Upload sources to start chatting..."
                        : hasProcessingSelected
                          ? "Waiting for sources to finish processing..."
                          : "Start typing..."
                  }
                  className="flex-1 bg-transparent border-none outline-none px-4 text-[14px] text-slate-700 disabled:cursor-not-allowed"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming || hasProcessingSelected || (readySources.length === 0 && !meetingActive)}
                />
                <div className="flex items-center gap-2 pr-1">
                  <button
                    type="button"
                    onClick={() => setDeepThinking(!deepThinking)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                      deepThinking
                        ? "bg-purple-600 text-white"
                        : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-500"
                    }`}
                    title={deepThinking ? "Deep Thinking is on — queries are decomposed for multi-angle retrieval" : "Enable Deep Thinking for complex questions"}
                  >
                    <Sparkles className="w-3 h-3 inline-block mr-1 -mt-px" />
                    {deepThinking ? "Thinking" : "Think Off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                      webSearchEnabled
                        ? "bg-[#5b8c15] text-white"
                        : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-500"
                    }`}
                  >
                    <Globe className="w-3 h-3 inline-block mr-1 -mt-px" />
                    Internet {webSearchEnabled ? "On" : "Off"}
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
            {/* PDF Viewer modal is rendered outside this panel — see below */}

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
                        <div className="flex items-center gap-1 shrink-0">
                          {isExpanded && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedNoteId(null); }}
                              className="text-slate-400 hover:text-slate-600 transition-colors"
                              title="Collapse"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); id && deleteNote(id, note.id); }}
                            className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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
        sharedChat={notebook?.shared_chat}
        onSharedChatToggle={async (enabled) => {
          if (!id) return;
          await api.toggleSharedChat(id, enabled);
          const nb = await api.getNotebook(id);
          setNotebook(nb);
          if (enabled) fetchHistory(id);
        }}
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
        onGenerate={(config: PptConfig) => {
          if (!id) return;
          setPptModalOpen(false);
          setPptLoading(true);
          api.downloadPPT(id, config)
            .catch((err) => console.error("PPT generation failed:", err))
            .finally(() => setPptLoading(false));
        }}
      />

      {/* Add Source Modal */}
      {showAddSourceModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeAddSourceModal}>
          <div className="bg-white rounded-[32px] w-full max-w-2xl p-10 relative shadow-2xl" onClick={(e) => e.stopPropagation()} onPaste={(e) => {
            const items = e.clipboardData.items;
            for (const item of Array.from(items)) {
              if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                  const ext = file.type.split("/")[1] || "png";
                  const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type });
                  setModalFiles(prev => [...prev, namedFile]);
                }
                return;
              }
            }
          }}>
            <button
              onClick={closeAddSourceModal}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="text-center mb-8">
              <h2 className="text-[32px] font-bold text-slate-900 leading-tight">Add sources to</h2>
              <h2 className="text-[32px] font-bold text-[#a3e635] leading-tight">your notebook</h2>
            </div>

            {/* Hidden file input */}
            <input
              ref={modalFileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp"
              className="sr-only"
              onChange={(e) => {
                handleModalFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />

            {/* Drop zone */}
            <label
              className="border-2 border-dashed border-slate-200 rounded-3xl p-10 flex flex-col items-center justify-center text-center bg-slate-50/50 cursor-pointer hover:border-[#5b8c15]/40 transition-colors"
              onClick={() => modalFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleModalFilesSelected(e.dataTransfer.files);
              }}
            >
              <Upload className="w-10 h-10 text-slate-300 mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Drag & drop your files here</h3>
              <p className="text-sm text-slate-400 mb-1">or paste an image from clipboard (Ctrl+V / Cmd+V)</p>
              <p className="text-sm text-slate-500 mb-1">
                pdf, images, docs,{' '}
                <span className="relative group/tip inline-block">
                  <span className="underline decoration-dotted underline-offset-2 cursor-default">and more</span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-slate-900 text-white text-xs leading-relaxed px-3 py-2.5 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 z-50 shadow-lg">
                    Supported: pdf, txt, md, docx, pptx, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp
                  </span>
                </span>
              </p>
              <p className="text-sm text-[#5b8c15] font-medium">or click to browse</p>
            </label>

            {/* URL input */}
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="flex items-center gap-1.5 text-sm font-medium text-[#5b8c15]">
                <Globe className="w-4 h-4" />
                Add website URL
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="url"
                    placeholder="example.com"
                    value={modalUrlInput}
                    onChange={(e) => { setModalUrlInput(e.target.value); setModalUrlError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleModalAddUrl(); } }}
                    className={`w-full h-10 pl-9 pr-3 rounded-xl border bg-white text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:ring-2 ${modalUrlError ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : 'border-slate-200 focus:border-[#5b8c15] focus:ring-[#5b8c15]/20'}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleModalAddUrl}
                  disabled={!modalUrlInput.trim()}
                  className="h-10 px-4 rounded-xl bg-[#5b8c15] text-white text-sm font-medium hover:bg-[#4a7311] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
              {modalUrlError && (
                <p className="mt-1.5 text-xs text-red-500">{modalUrlError}</p>
              )}
            </div>

            {/* Pending URLs list */}
            {modalUrls.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {modalUrls.map((url, i) => (
                  <div key={i} className="px-3 py-2 bg-blue-50 rounded-xl text-sm">
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="flex-1 truncate text-slate-700">{url}</span>
                      <button onClick={() => setModalUrls(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-600 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Selected files list */}
            {modalFiles.length > 0 && (
              <div className="mt-4 max-h-40 overflow-y-auto space-y-1.5">
                {modalFiles.map((file, i) => (
                  <div key={i} className="px-3 py-2 bg-slate-50 rounded-xl text-sm">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="flex-1 truncate text-slate-700">{file.name}</span>
                      <span className="text-xs text-slate-400 shrink-0">{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span>
                      <button onClick={() => setModalFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-600 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upload button */}
            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                onClick={handleModalSubmit}
                disabled={modalFiles.length === 0 && modalUrls.length === 0}
                className="w-full max-w-xs bg-[#5b8c15] text-white py-3 rounded-xl font-semibold hover:bg-[#4a7311] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {modalFiles.length + modalUrls.length > 0
                  ? `Upload ${modalFiles.length + modalUrls.length} source${modalFiles.length + modalUrls.length > 1 ? 's' : ''}`
                  : 'Upload Sources'}
              </button>
            </div>
            <p className="text-center text-xs text-slate-400 mt-4">Up to 100 files, {maxFileSizeMB} MB each.</p>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />

      {/* Hotwords Modal */}
      {showHotwords && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowHotwords(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-[380px] max-h-[70vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">ASR Hotwords</h3>
              <p className="text-xs text-slate-400 mt-0.5">Add proper nouns, brand names, or technical terms to improve transcription accuracy</p>
            </div>
            <div className="px-5 py-3 max-h-[40vh] overflow-y-auto">
              {hotwords.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No hotwords yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hotwords.map((w) => (
                    <span key={w} className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-sm text-slate-700">
                      {w}
                      <button
                        onClick={() => saveHotwords(hotwords.filter((h) => h !== w))}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const word = hotwordInput.trim();
                  if (word && !hotwords.includes(word)) {
                    saveHotwords([...hotwords, word]);
                    setHotwordInput("");
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={hotwordInput}
                  onChange={(e) => setHotwordInput(e.target.value)}
                  placeholder="e.g. Dify, JOTO, GPT-4o"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
                />
                <button
                  type="submit"
                  className="px-3 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors"
                >
                  Add
                </button>
              </form>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowHotwords(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Viewer Modal */}
      {pdfViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8" onClick={closePdf}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          {/* Modal */}
          <div
            className="relative w-full max-w-5xl h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/80 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800 truncate">{pdfViewer.filename}</h3>
                  {pdfViewer.page > 1 && (
                    <p className="text-[11px] text-slate-400">Page {pdfViewer.page}</p>
                  )}
                </div>
              </div>
              <button
                onClick={closePdf}
                className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {/* PDF Content */}
            <div className="flex-1 bg-slate-100">
              <iframe
                key={pdfViewer._seq}
                src={`/api/notebooks/${id}/sources/${pdfViewer.sourceId}/file?token=${api.getToken()}#page=${pdfViewer.page}`}
                className="w-full h-full border-none"
                title={pdfViewer.filename}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
