import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, User, Users, ChevronRight, X, Upload, LogOut, Star, FileText, Loader2, Shield, Trash2, Globe, Link as LinkIcon, Bug, MoreHorizontal, Pencil, Sparkles, Mic, Settings } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useNotebookStore } from '@/stores/notebook-store';
import { api } from '@/services/api';
import { setPendingUploadFiles, setPendingUploadUrls } from '@/stores/pending-upload-store';
import type { Notebook } from '@/types/api';
import ShareModal from '@/components/sharing/ShareModal';
import FeedbackModal from '@/components/FeedbackModal';
import { useMeetingStore } from '@/features/meeting/meeting-store';

const EMOJIS = ['📝', '🚀', '🔬', '📈', '💡', '💰', '⚡', '🎨', '🏷️', '📋', '⚙️', '📅', '🌟', '🎯', '📚', '🧪', '🔥', '🌈', '🎵', '🧠'];
const COLORS = ['#ecfccb', '#dbeafe', '#d1fae5', '#fef08a', '#fed7aa', '#f3e8ff', '#cffafe', '#fce7f3', '#e0e7ff', '#ffedd5'];

function randomEmoji(): string {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

/** Derive a stable pastel color from notebook id when default #4A90D9 is used */
function cardColor(nb: Notebook): string {
  if (nb.cover_color && nb.cover_color !== '#4A90D9') return nb.cover_color;
  let hash = 0;
  for (let i = 0; i < nb.id.length; i++) hash = (hash * 31 + nb.id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = date.getFullYear();
  const now = new Date();
  if (year === now.getFullYear()) {
    return `${months[date.getMonth()]} ${day}`;
  }
  return `${months[date.getMonth()]} ${day}, ${year}`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { notebooks, isLoading, fetchNotebooks, createNotebook, deleteNotebook } = useNotebookStore();
  // Recording indicator: combine client-side store + server-side active meetings
  const storeRecNotebookId = useMeetingStore((s) => s.isRecording ? s.activeMeeting?.notebook_id : null);
  const storeRecPaused = useMeetingStore((s) => s.isPaused);
  const [serverActiveMeetings, setServerActiveMeetings] = useState<Record<string, 'recording' | 'paused'>>({});

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    fetch('/api/meetings/my-active', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((meetings: Array<{ notebook_id: string; status: string }>) => {
        const map: Record<string, 'recording' | 'paused'> = {};
        for (const m of meetings) {
          map[m.notebook_id] = m.status as 'recording' | 'paused';
        }
        setServerActiveMeetings(map);
      })
      .catch(() => {});
  }, []);

  // Merge: client store takes priority (real-time), server fills in for other tabs/sessions
  const getRecordingStatus = (notebookId: string): 'recording' | 'paused' | null => {
    if (storeRecNotebookId === notebookId) return storeRecPaused ? 'paused' : 'recording';
    if (serverActiveMeetings[notebookId]) return serverActiveMeetings[notebookId];
    return null;
  };

  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showAllPersonal, setShowAllPersonal] = useState(false);
  const [showAllTeam, setShowAllTeam] = useState(false);
  const [createModalType, setCreateModalType] = useState<'personal' | 'team' | null>(null);
  const [teamNotebookId, setTeamNotebookId] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('starredNotebooks');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [seenNotebookIds, setSeenNotebookIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('seenNotebooks');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [notebookName, setNotebookName] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showCustomPrompt, setShowCustomPrompt] = useState(true);
  const [personaPreset, setPersonaPreset] = useState<string>("balanced");
  const [isCreating, setIsCreating] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [pendingUrls, setPendingUrlsList] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(true);
  const [showHotwords, setShowHotwords] = useState(false);
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [hotwordInput, setHotwordInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load hotwords
  useEffect(() => {
    // Use any notebook id to fetch user-level hotwords (they're per-user, not per-notebook)
    const nbId = notebooks[0]?.id;
    if (!nbId) return;
    fetch(`/api/notebooks/${nbId}/meetings/hotwords`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
    })
      .then((r) => r.json())
      .then((d) => setHotwords(d.words || []))
      .catch(() => {});
  }, [notebooks]);

  const saveHotwords = (words: string[]) => {
    const nbId = notebooks[0]?.id;
    if (!nbId) return;
    setHotwords(words);
    fetch(`/api/notebooks/${nbId}/meetings/hotwords`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      body: JSON.stringify({ words }),
    }).catch(() => {});
  };

  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  // Close create-menu dropdown when clicking outside
  useEffect(() => {
    if (!isCreateMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setIsCreateMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCreateMenuOpen]);

  // Close Create Notebook modal on Escape key
  useEffect(() => {
    if (!createModalType) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeModal();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [createModalType]);

  // Close card menu dropdown when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  const handleRenameNotebook = async (notebookId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditingNameId(null);
      return;
    }
    try {
      await api.updateNotebook(notebookId, { name: trimmed });
      await fetchNotebooks();
    } catch {
      // silently fail
    }
    setEditingNameId(null);
  };

  const personalNotebooks = notebooks.filter(
    (nb) => nb.user_role === 'owner' && !nb.is_shared
  );
  const teamNotebooks = notebooks.filter(
    (nb) => nb.is_shared || nb.user_role !== 'owner'
  );

  // Sort: starred first, then preserve backend order (updated_at DESC)
  const sortedPersonal = [...personalNotebooks].sort(
    (a, b) => {
      const starDiff = (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0);
      if (starDiff !== 0) return starDiff;
      // Preserve backend order (already sorted by updated_at DESC)
      return personalNotebooks.indexOf(a) - personalNotebooks.indexOf(b);
    }
  );
  const NEW_INVITE_DAYS = 7;
  const isNewInvite = (nb: Notebook) => {
    if (!nb.joined_at || nb.user_role === 'owner') return false;
    if (seenNotebookIds.has(nb.id)) return false;
    const joinedMs = new Date(nb.joined_at).getTime();
    return Date.now() - joinedMs < NEW_INVITE_DAYS * 86400000;
  };

  const sortedTeam = [...teamNotebooks].sort(
    (a, b) => {
      // 1. Starred first
      const starDiff = (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0);
      if (starDiff !== 0) return starDiff;
      // 2. New invites second (after starred)
      const newDiff = (isNewInvite(b) ? 1 : 0) - (isNewInvite(a) ? 1 : 0);
      if (newDiff !== 0) return newDiff;
      // 3. Then by updated_at (backend order)
      return teamNotebooks.indexOf(a) - teamNotebooks.indexOf(b);
    }
  );

  const displayedPersonal = showAllPersonal ? sortedPersonal : sortedPersonal.slice(0, 8);
  const displayedTeam = showAllTeam ? sortedTeam : sortedTeam.slice(0, 8);

  const toggleStarred = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      localStorage.setItem('starredNotebooks', JSON.stringify([...next]));
      return next;
    });
  };

  const handleDeleteNotebook = async (notebook: Notebook, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${notebook.name}"? This cannot be undone.`)) return;
    try {
      await deleteNotebook(notebook.id);
    } catch {
      // silently fail
    }
  };

  const closeModal = () => {
    setCreateModalType(null);
    setTeamNotebookId(null);
    setPendingFiles([]);
    setPendingUrlsList([]);
    setUrlInput('');
    setUrlError(null);
    setShowUrlInput(false);
    setNotebookName('');
    setCustomPrompt('');
    setShowCustomPrompt(true);
    setIsCreating(false);
  };

  const handleOpenNotebook = (notebook: Notebook) => {
    // Mark as seen (removes "New" badge)
    if (isNewInvite(notebook)) {
      setSeenNotebookIds(prev => {
        const next = new Set(prev);
        next.add(notebook.id);
        localStorage.setItem('seenNotebooks', JSON.stringify([...next]));
        return next;
      });
    }
    navigate('/notebook/' + notebook.id);
  };

  const [maxFileSizeMB, setMaxFileSizeMB] = useState(200);
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(d => setMaxFileSizeMB(d.max_file_size_mb || 200)).catch(() => {}); }, []);
  const MAX_FILE_SIZE = maxFileSizeMB * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set([
    'pdf', 'docx', 'pptx', 'txt', 'md',
    'xlsx', 'xls', 'csv',
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp',
    'mp3', 'wav', 'm4a', 'flac', 'ogg', 'webm',
  ]);

  const handleFilesSelected = (files: FileList | null) => {
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
    if (messages.length > 0) {
      alert(messages.join('\n\n'));
    }
    if (pendingFiles.length + accepted.length > 100) {
      alert('Maximum 100 files allowed per notebook.');
      return;
    }
    setPendingFiles(prev => [...prev, ...accepted]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddUrl = () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch {
      setUrlError('Please enter a valid domain or URL');
      return;
    }
    if (pendingUrls.includes(url)) {
      setUrlInput('');
      setUrlError(null);
      return;
    }
    setPendingUrlsList(prev => [...prev, url]);
    setUrlInput('');
    setUrlError(null);
  };

  const removePendingUrl = (index: number) => {
    setPendingUrlsList(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateAndUpload = async (isTeam: boolean) => {
    setIsCreating(true);
    try {
      const name = notebookName.trim();
      const notebook = await createNotebook({
        name,
        emoji: randomEmoji(),
        cover_color: randomColor(),
        is_team: isTeam,
        ...(customPrompt.trim() ? { custom_prompt: customPrompt.trim() } : {}),
      });

      const filesToUpload = [...pendingFiles];
      const urlsToAdd = [...pendingUrls];

      if (isTeam) {
        // For team notebooks, close create modal and open ShareModal
        setTeamNotebookId(notebook.id);
        setCreateModalType(null);
        setPendingFiles([]);
        setPendingUrlsList([]);
        setNotebookName('');
        setIsCreating(false);
        setIsShareModalOpen(true);
        // Store files/urls for NotebookPage to pick up after share modal closes
        if (filesToUpload.length > 0) setPendingUploadFiles(filesToUpload);
        if (urlsToAdd.length > 0) setPendingUploadUrls(urlsToAdd);
      } else {
        // Store files/urls for NotebookPage to pick up
        if (filesToUpload.length > 0) setPendingUploadFiles(filesToUpload);
        if (urlsToAdd.length > 0) setPendingUploadUrls(urlsToAdd);
        closeModal();
        navigate('/notebook/' + notebook.id);
      }
    } catch {
      setIsCreating(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userName = user?.name || 'User';
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-slate-900 pb-12">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-5">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Noteflow" className="w-10 h-10 rounded-xl" />
          <span className="text-2xl font-bold tracking-tight">Noteflow</span>
          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#5b8c15]/10 text-[#5b8c15] rounded-md">Alpha</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Report Bug & Make a Wish"
          >
            <Bug className="w-4 h-4" />
            <span className="hidden md:inline">Report Bug</span>
          </button>
          <div className="text-right hidden md:block">
            <div className="font-semibold text-sm">{userName}</div>
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
            <button
              className="w-11 h-11 rounded-full bg-[#5b8c15] text-white flex items-center justify-center font-bold text-lg hover:bg-[#4a7311] transition-colors"
            >
              {userInitial}
            </button>

            {/* Profile Dropdown */}
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
                    onClick={() => { setIsProfileMenuOpen(false); navigate('/settings'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                  <button
                    onClick={() => { setIsProfileMenuOpen(false); setShowHotwords(true); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Mic className="w-4 h-4" />
                    ASR Hotwords
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

      {/* Main Content */}
      <main className="max-w-[1200px] mx-auto px-4 md:px-8 mt-8">
        {/* Personal Notebooks Section */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6 relative">
            <h2 className="text-xl md:text-[28px] font-bold tracking-tight">Personal Notebooks</h2>
            <div
              className="relative"
              ref={createMenuRef}
              onMouseEnter={() => {
                if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                setIsCreateMenuOpen(true);
              }}
              onMouseLeave={() => {
                hoverTimeoutRef.current = setTimeout(() => setIsCreateMenuOpen(false), 150);
              }}
            >
              <button
                onClick={() => setIsCreateMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 bg-[#5b8c15] hover:bg-[#4a7311] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Create New
              </button>

              {/* Dropdown Menu */}
              {isCreateMenuOpen && (
                <div className="absolute top-full right-0 pt-2 z-20">
                  <div className="w-72 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 overflow-hidden">
                    <button
                      onClick={() => {
                        setCreateModalType('personal');
                        setIsCreateMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="bg-[#ecfccb] p-2.5 rounded-xl text-[#5b8c15]">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-900">Personal Notebook</div>
                        <div className="text-xs text-slate-500 mt-0.5">Private to you</div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setCreateModalType('team');
                        setIsCreateMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors text-left border-t border-slate-50"
                    >
                      <div className="bg-[#dbeafe] p-2.5 rounded-xl text-blue-600">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-900">Team Notebook</div>
                        <div className="text-xs text-slate-500 mt-0.5">Shared with workspace</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isLoading && personalNotebooks.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm animate-pulse">
                  <div className="h-36 bg-slate-100" />
                  <div className="p-5 space-y-3">
                    <div className="h-4 bg-slate-100 rounded w-3/4" />
                    <div className="h-3 bg-slate-50 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : personalNotebooks.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm font-medium">
              No personal notebooks yet. Create one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {displayedPersonal.map((notebook) => (
                <div
                  key={notebook.id}
                  onClick={() => handleOpenNotebook(notebook)}
                  className={`bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer group relative ${openMenuId === notebook.id ? "z-40" : ""}`}
                >
                  <div
                    className="h-36 flex items-center justify-center text-5xl group-hover:opacity-90 transition-opacity relative rounded-t-2xl overflow-hidden"
                    style={{ backgroundColor: cardColor(notebook) }}
                  >
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      {getRecordingStatus(notebook.id) && (
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${getRecordingStatus(notebook.id) === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                          {getRecordingStatus(notebook.id) === 'recording' && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>}
                          {getRecordingStatus(notebook.id) === 'paused' ? 'PAUSED' : 'REC'}
                        </span>
                      )}
                      <button
                        onClick={(e) => toggleStarred(notebook.id, e)}
                        className="bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-white transition-colors"
                      >
                        <Star className={`w-3.5 h-3.5 ${starredIds.has(notebook.id) ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                      </button>
                    </div>
                    <span className="text-6xl drop-shadow-sm">{notebook.emoji}</span>
                  </div>
                  <div className="p-5 flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      {editingNameId === notebook.id ? (
                        <input
                          type="text"
                          value={editingNameValue}
                          onChange={(e) => setEditingNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameNotebook(notebook.id, editingNameValue);
                            if (e.key === 'Escape') setEditingNameId(null);
                          }}
                          onBlur={() => handleRenameNotebook(notebook.id, editingNameValue)}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                          maxLength={100}
                          className="font-bold text-base mb-1.5 w-full text-slate-900 border border-slate-300 rounded-lg px-2 py-0.5 outline-none focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                        />
                      ) : (
                        <h3 className="font-bold text-base mb-1.5 truncate text-slate-900">{notebook.name}</h3>
                      )}
                      <div className="text-[13px] text-slate-500 font-medium">
                        {formatRelativeDate(notebook.created_at)} <span className="mx-1.5 text-slate-300">&bull;</span> {notebook.source_count} {notebook.source_count === 1 ? 'source' : 'sources'}
                      </div>
                    </div>
                    {!notebook.is_just_chat && (
                    <div
                      className="relative flex-shrink-0 ml-2 self-end"
                      ref={openMenuId === notebook.id ? menuRef : undefined}
                      onMouseEnter={() => {
                        if (menuHoverRef.current) clearTimeout(menuHoverRef.current);
                        setOpenMenuId(notebook.id);
                      }}
                      onMouseLeave={() => {
                        menuHoverRef.current = setTimeout(() => setOpenMenuId(null), 500);
                      }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === notebook.id ? null : notebook.id); }}
                        className="p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="More options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openMenuId === notebook.id && (
                        <div className="absolute top-full right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              setEditingNameValue(notebook.name);
                              setEditingNameId(notebook.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => { setOpenMenuId(null); handleDeleteNotebook(notebook, e); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {personalNotebooks.length > 8 && (
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setShowAllPersonal(!showAllPersonal)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[#5b8c15] bg-white px-5 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
              >
                {showAllPersonal ? 'Show less' : 'See all'} <ChevronRight className={`w-4 h-4 transition-transform ${showAllPersonal ? '-rotate-90' : ''}`} />
              </button>
            </div>
          )}
        </section>

        {/* Team Notebooks Section */}
        <section className="mb-16">
          <h2 className="text-xl md:text-[28px] font-bold tracking-tight mb-6">Team Notebooks</h2>

          {isLoading && teamNotebooks.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm animate-pulse">
                  <div className="h-36 bg-slate-100" />
                  <div className="p-5 space-y-3">
                    <div className="h-4 bg-slate-100 rounded w-3/4" />
                    <div className="h-3 bg-slate-50 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : teamNotebooks.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm font-medium">
              No team notebooks yet. Create one or get invited to join.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 overflow-visible">
              {displayedTeam.map((notebook) => (
                <div
                  key={notebook.id}
                  onClick={() => handleOpenNotebook(notebook)}
                  className={`bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer group relative ${openMenuId === notebook.id ? "z-40" : ""}`}
                >
                  <div
                    className="h-36 relative flex items-center justify-center group-hover:opacity-90 transition-opacity rounded-t-2xl overflow-hidden"
                    style={{ backgroundColor: cardColor(notebook) }}
                  >
                    <div className="absolute top-4 left-4 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-white/90 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 shadow-sm">
                        <Users className="w-3.5 h-3.5" /> {notebook.member_count}
                      </div>
                    </div>
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      {getRecordingStatus(notebook.id) && (
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${getRecordingStatus(notebook.id) === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                          {getRecordingStatus(notebook.id) === 'recording' && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>}
                          {getRecordingStatus(notebook.id) === 'paused' ? 'PAUSED' : 'REC'}
                        </span>
                      )}
                      <button
                        onClick={(e) => toggleStarred(notebook.id, e)}
                        className="bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-white transition-colors"
                      >
                        <Star className={`w-3.5 h-3.5 ${starredIds.has(notebook.id) ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                      </button>
                    </div>
                    <span className="text-6xl drop-shadow-sm">{notebook.emoji}</span>
                  </div>
                  <div className="p-5 flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                    {editingNameId === notebook.id ? (
                      <input
                        type="text"
                        value={editingNameValue}
                        onChange={(e) => setEditingNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameNotebook(notebook.id, editingNameValue);
                          if (e.key === 'Escape') setEditingNameId(null);
                        }}
                        onBlur={() => handleRenameNotebook(notebook.id, editingNameValue)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        maxLength={100}
                        className="font-bold text-base mb-1.5 w-full text-slate-900 border border-slate-300 rounded-lg px-2 py-0.5 outline-none focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                      />
                    ) : (
                    <h3 className="font-bold text-base mb-1.5 truncate text-slate-900 flex items-center gap-2">
                      {notebook.name}
                      {isNewInvite(notebook) && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-600 rounded-md shrink-0">New</span>
                      )}
                    </h3>
                    )}
                    <div className="text-[13px] text-slate-500 font-medium">
                      {formatRelativeDate(notebook.created_at)} <span className="mx-1.5 text-slate-300">&bull;</span> {notebook.source_count} {notebook.source_count === 1 ? 'source' : 'sources'}
                    </div>
                    </div>
                    {notebook.user_role === 'owner' && !notebook.is_just_chat && (
                    <div
                      className="relative flex-shrink-0 ml-2 self-end"
                      ref={openMenuId === notebook.id ? menuRef : undefined}
                      onMouseEnter={() => {
                        if (menuHoverRef.current) clearTimeout(menuHoverRef.current);
                        setOpenMenuId(notebook.id);
                      }}
                      onMouseLeave={() => {
                        menuHoverRef.current = setTimeout(() => setOpenMenuId(null), 500);
                      }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === notebook.id ? null : notebook.id); }}
                        className="p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="More options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openMenuId === notebook.id && (
                        <div className="absolute top-full right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              setEditingNameValue(notebook.name);
                              setEditingNameId(notebook.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => { setOpenMenuId(null); handleDeleteNotebook(notebook, e); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {teamNotebooks.length > 8 && (
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setShowAllTeam(!showAllTeam)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[#5b8c15] bg-white px-5 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
              >
                {showAllTeam ? 'Show less' : 'See all'} <ChevronRight className={`w-4 h-4 transition-transform ${showAllTeam ? '-rotate-90' : ''}`} />
              </button>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between text-[13px] font-medium text-slate-500">
          <div>上海聚托信息科技有限公司©2026 <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">沪ICP备15056478号-5</a></div>
          <div className="flex items-center gap-8 mt-4 md:mt-0">
            <Link to="/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
            <Link to="/help" className="hover:text-slate-900 transition-colors">Help Center</Link>
          </div>
        </footer>
      </main>

      {/* Create Modal */}
      {createModalType && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-[32px] w-full max-w-2xl p-10 relative shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={closeModal}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="text-center mb-8">
              <h2 className="text-[32px] font-bold text-slate-900 leading-tight">Create a Notebook from</h2>
              <h2 className="text-[32px] font-bold text-[#a3e635] leading-tight">your documents</h2>
            </div>

            {/* Hidden file input */}
            <input
              id="create-modal-file-input"
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp3,.wav,.m4a,.flac,.ogg,.webm"
              className="sr-only"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />

            <>
                {/* Notebook name input */}
                <div className="mb-6">
                  <input
                    type="text"
                    placeholder="Notebook name"
                    value={notebookName}
                    maxLength={100}
                    onChange={(e) => setNotebookName(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                    autoFocus
                  />
                </div>

                {/* Drop zone */}
                <label
                  htmlFor="create-modal-file-input"
                  className="border-2 border-dashed border-slate-200 rounded-3xl p-10 flex flex-col items-center justify-center text-center bg-slate-50/50 cursor-pointer hover:border-[#5b8c15]/40 transition-colors"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFilesSelected(e.dataTransfer.files);
                  }}
                >
                  <Upload className="w-10 h-10 text-slate-300 mb-4" />
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Drag & drop your files here</h3>
                  <p className="text-sm text-slate-500 mb-1">
                    pdf, images, docs, audio,{' '}
                    <span className="relative group/tip inline-block">
                      <span className="underline decoration-dotted underline-offset-2 cursor-default">and more</span>
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-slate-900 text-white text-xs leading-relaxed px-3 py-2.5 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 z-50 shadow-lg">
                        Supported file types: pdf, txt, md, docx, pptx, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp, mp3, wav, m4a
                      </span>
                    </span>
                  </p>
                  <p className="text-sm text-[#5b8c15] font-medium">or click to browse</p>
                </label>

                {/* URL input toggle */}
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${showUrlInput ? 'text-[#5b8c15]' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Globe className="w-4 h-4" />
                    Add website URL
                  </button>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* URL input field */}
                {showUrlInput && (
                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="url"
                          placeholder="example.com"
                          value={urlInput}
                          onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddUrl(); } }}
                          className={`w-full h-10 pl-9 pr-3 rounded-xl border bg-white text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:ring-2 ${urlError ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : 'border-slate-200 focus:border-[#5b8c15] focus:ring-[#5b8c15]/20'}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddUrl}
                        disabled={!urlInput.trim()}
                        className="h-10 px-4 rounded-xl bg-[#5b8c15] text-white text-sm font-medium hover:bg-[#4a7311] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Add
                      </button>
                    </div>
                    {urlError && (
                      <p className="mt-1.5 text-xs text-red-500">{urlError}</p>
                    )}
                  </div>
                )}

                {/* Pending URLs list */}
                {pendingUrls.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {pendingUrls.map((url, i) => (
                      <div key={i} className="px-3 py-2 bg-blue-50 rounded-xl text-sm">
                        <div className="flex items-center gap-3">
                          <Globe className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="flex-1 truncate text-slate-700">{url}</span>
                          {!isCreating && (
                            <button onClick={() => removePendingUrl(i)} className="text-slate-400 hover:text-slate-600 shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Selected files list */}
                {pendingFiles.length > 0 && (
                  <div className="mt-4 max-h-40 overflow-y-auto space-y-1.5">
                    {pendingFiles.map((file, i) => (
                      <div key={i} className="px-3 py-2 bg-slate-50 rounded-xl text-sm">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="flex-1 truncate text-slate-700">{file.name}</span>
                          <span className="text-xs text-slate-400 shrink-0">{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span>
                          {!isCreating && (
                            <button onClick={() => removePendingFile(i)} className="text-slate-400 hover:text-slate-600 shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notebook Persona */}
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={() => setShowCustomPrompt(!showCustomPrompt)}
                    className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${showCustomPrompt ? 'text-[#5b8c15]' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    Notebook Persona
                  </button>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                {showCustomPrompt && (() => {
                  const presets = [
                    { key: "balanced", label: "Balanced", prompt: "1. Use the provided documents as your primary source of facts.\n2. For factual questions (dates, names, numbers, policies), answer strictly based on documents.\n3. For advisory/analytical questions (suggestions, strategies, risks, \"what should we do\"), go beyond summarizing — provide your own insights, critical thinking, and actionable recommendations while still citing relevant document facts.\n4. If the context does not directly answer the question, present any related information and synthesize it. Only if there is truly NO related content, state that the documents do not contain this information.\n5. Be thorough and comprehensive — draw from all relevant context, not just the most obvious match.\n6. When the question asks about a specific date, scan ALL chunks for that date in any format." },
                    { key: "strict", label: "Strict", prompt: "You are a precise, document-grounded research assistant.\n\n1. Answer ONLY based on information explicitly stated in the provided documents. Do not infer, speculate, or add external knowledge — even for advisory questions.\n2. If the documents do not contain the answer, state clearly: \"The provided documents do not contain this information.\" Do not attempt to guess or fill gaps with general knowledge.\n3. If you cannot cite a claim, do not say it. Every statement must be traceable to a specific source.\n4. When multiple documents discuss the same topic, compare and note any differences or contradictions between them.\n5. Preserve the original terminology and phrasing from the documents — do not paraphrase key terms.\n6. If a question is ambiguous, ask for clarification rather than assuming intent.\n7. When presenting information, clearly separate what the documents state from any logical inferences." },
                    { key: "advisor", label: "Advisor", prompt: "You are a senior strategic advisor with deep analytical expertise. Your role is to help decision-makers:\n\n1. Go beyond summarizing — provide critical analysis, identify patterns, and surface non-obvious insights that the reader might miss.\n2. For every key finding, assess its implications: What does this mean? What are the risks? What opportunities does it create?\n3. Provide actionable recommendations with clear reasoning. Frame suggestions as \"Consider...\", \"Recommend...\", or \"Priority action:...\"\n4. When relevant, present pros/cons analysis or risk-reward tradeoffs in structured format (tables or bullet points).\n5. Connect information across multiple documents to build a comprehensive picture — don't treat each source in isolation.\n6. Flag any gaps in the available information that would affect decision quality.\n7. Prioritize insights by impact and urgency. Lead with the most important findings.\n8. Add your own expert interpretation on top of document evidence — the user expects analysis, not just summaries." },
                    { key: "concise", label: "Concise", prompt: "You are a concise, no-nonsense assistant optimized for speed and clarity:\n\n1. Keep every response under 150 words unless the user explicitly asks for more detail.\n2. Use bullet points as the default format. No lengthy paragraphs.\n3. Lead with the direct answer in the first sentence — no preamble or context-setting.\n4. Maximum 3-5 bullet points per response. Each bullet should be one clear, complete thought.\n5. Use bold for key terms, numbers, and names to make scanning easy.\n6. Skip pleasantries, filler phrases (\"Great question!\", \"Based on the documents...\"), and restating the question.\n7. If the answer requires nuance, give the short answer first, then add a \"Details:\" section only if necessary.\n8. For yes/no questions, start with \"Yes\" or \"No\" immediately." },
                    { key: "teacher", label: "Teacher", prompt: "You are a patient, encouraging tutor who makes complex information accessible:\n\n1. Explain concepts step by step, building from simple to complex. Never assume prior knowledge.\n2. Use analogies and real-world examples to make abstract ideas concrete.\n3. Break long explanations into numbered steps or clearly labeled sections.\n4. After explaining a concept, briefly summarize the key takeaway in one sentence.\n5. When introducing technical terms or jargon from the documents, define them in simple language.\n6. Use questions to guide thinking: \"Notice how...\" or \"Consider why this matters...\"\n7. If the topic is complex, offer to break it into smaller parts: \"Let me explain this in three parts...\"\n8. Encourage deeper exploration: suggest follow-up questions the user might want to ask.\n9. Use a warm, supportive tone — treat every question as a good question." },
                    { key: "custom", label: "Custom", prompt: "" },
                  ];
                  const isCustom = personaPreset === "custom";
                  const currentPreset = presets.find(p => p.key === personaPreset);
                  const displayValue = isCustom ? customPrompt : (currentPreset?.prompt || "");
                  return (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {presets.map((p) => (
                        <button key={p.key} type="button"
                          onClick={() => {
                            setPersonaPreset(p.key);
                            if (p.key === "custom") {
                              setCustomPrompt("");
                            } else {
                              setCustomPrompt(p.prompt);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                            personaPreset === p.key
                              ? "bg-[#5b8c15] text-white border-[#5b8c15]"
                              : "bg-white text-slate-600 border-slate-200 hover:border-[#5b8c15]/40 hover:text-[#5b8c15]"
                          }`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      placeholder={isCustom ? "Write your custom persona instructions here..." : ""}
                      value={displayValue}
                      onChange={(e) => { if (isCustom) setCustomPrompt(e.target.value); }}
                      readOnly={!isCustom}
                      rows={4}
                      className={`w-full px-4 py-3 rounded-xl border border-slate-200 text-sm outline-none transition-all resize-none ${
                        !isCustom ? "bg-slate-50 text-slate-500 cursor-default" : "bg-white text-slate-900 focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                      }`}
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-slate-400">
                        {isCustom ? "Write your own or use AI Optimize" : "Read-only preview — select Custom to edit"}
                      </p>
                      {isCustom && <button
                        type="button"
                        onClick={async () => {
                          if (!customPrompt.trim()) return;
                          setIsOptimizingPrompt(true);
                          try {
                            const optimized = await api.optimizePrompt(customPrompt.trim());
                            setCustomPrompt(optimized);
                          } catch {
                            // silently fail
                          } finally {
                            setIsOptimizingPrompt(false);
                          }
                        }}
                        disabled={isOptimizingPrompt || !customPrompt.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#5b8c15] bg-[#5b8c15]/10 hover:bg-[#5b8c15]/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        <Sparkles className="w-3 h-3" />
                        {isOptimizingPrompt ? "Optimizing..." : "AI Optimize"}
                      </button>}
                    </div>
                  </div>
                  );
                })()}

                {/* Action buttons */}
                <div className="mt-6 flex flex-col items-center gap-3">
                  {createModalType === 'team' ? (
                    <button
                      onClick={() => handleCreateAndUpload(true)}
                      disabled={isCreating || !notebookName.trim()}
                      className="w-full max-w-xs bg-[#5b8c15] text-white py-3 rounded-xl font-semibold hover:bg-[#4a7311] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isCreating ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                        </span>
                      ) : 'Next: Invite Members'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCreateAndUpload(false)}
                      disabled={isCreating || !notebookName.trim()}
                      className="w-full max-w-xs bg-[#5b8c15] text-white py-3 rounded-xl font-semibold hover:bg-[#4a7311] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isCreating ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                        </span>
                      ) : (
                        (pendingFiles.length > 0 || pendingUrls.length > 0)
                          ? `Create Notebook (${pendingFiles.length + pendingUrls.length} source${pendingFiles.length + pendingUrls.length > 1 ? 's' : ''})`
                          : 'Create Notebook'
                      )}
                    </button>
                  )}
                </div>
                <p className="text-center text-xs text-slate-400 mt-4">Up to 100 files, {maxFileSizeMB} MB each.</p>
              </>
          </div>
        </div>
      )}

      {/* Share Modal for team notebook invite */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => {
          setIsShareModalOpen(false);
          if (teamNotebookId) {
            navigate('/notebook/' + teamNotebookId);
            setTeamNotebookId(null);
          }
        }}
        notebookId={teamNotebookId || ""}
      />

      {/* Feedback Modal */}
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />

      {/* Hotwords Modal */}
      {showHotwords && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowHotwords(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-[380px] max-h-[70vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">ASR Hotwords</h3>
              <p className="text-xs text-slate-400 mt-0.5">Improve transcription accuracy with proper nouns and technical terms. Applied globally across all notebooks.</p>
            </div>
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-[11px] text-slate-500 mb-2">Industry presets (click to add, click again to remove)</p>
              <div className="flex flex-wrap gap-1.5">
                {(["AI", "Education", "Finance", "Healthcare"] as const).map(industry => {
                  const presets: Record<string, string[]> = {
                    AI: ["GPT-4o","GPT-4","Claude","Gemini","LLaMA","Qwen","DeepSeek","Mistral","ChatGPT","Copilot","Dify","LangChain","LlamaIndex","RAG","LLM","NLP","Transformer","BERT","LoRA","QLoRA","Fine-tuning","Embedding","Vector Database","Pinecone","Weaviate","Milvus","ChromaDB","FAISS","Prompt Engineering","Chain-of-Thought","ReAct","AutoGPT","Agent","Multi-Agent","MCP","Function Calling","Tool Use","Tokenizer","Attention","Diffusion","Stable Diffusion","Midjourney","DALL-E","ComfyUI","TensorFlow","PyTorch","Hugging Face","ONNX","vLLM","Ollama"],
                    Education: ["IB","AP","A-Level","SAT","ACT","IELTS","TOEFL","GPA","IGCSE","MYP","PYP","Diploma Programme","Common App","Naviance","PowerSchool","Schoology","Canvas","Google Classroom","Turnitin","Managebac","WASC","CIS","NEASC","EARCOS","ACAMIS","SAS","ISB","HKIS","TAS","Curriculum","Rubric","Differentiation","Scaffolding","Formative Assessment","Summative Assessment","IEP","EAL","ESL","STEAM","SEL","Homeroom","Advisory","Capstone","Extended Essay","CAS","TOK","Internal Assessment","College Counseling","Transcript","Valedictorian"],
                    Finance: ["ROI","EBITDA","P&L","GAAP","IFRS","IPO","M&A","PE Ratio","EPS","NAV","AUM","ETF","Hedge Fund","Venture Capital","Series A","Series B","Unicorn","Cap Table","Convertible Note","SAFE","Term Sheet","Due Diligence","LBO","DCF","WACC","Beta","Alpha","Sharpe Ratio","Yield Curve","Treasury","Fed Rate","Basis Points","Forex","Swap","Derivative","Compliance","KYC","AML","Basel III","Fintech","DeFi","Stablecoin","SWIFT","ACH","SEPA","Wire Transfer","Escrow","Amortization","Depreciation","Working Capital"],
                    Healthcare: ["EHR","EMR","HIPAA","FDA","ICD-10","CPT","DRG","Telemedicine","Telehealth","mRNA","CRISPR","Biomarker","Clinical Trial","Phase III","Placebo","Double-Blind","IRB","Informed Consent","Adverse Event","Pharmacovigilance","GMP","GCP","CRO","CMO","API","Biosimilar","Monoclonal Antibody","Immunotherapy","CAR-T","PD-1","Oncology","Radiology","Pathology","MRI","CT Scan","Ultrasound","CBC","A1C","BMI","ICU","OR","ER","Triage","Diagnosis","Prognosis","Contraindication","Comorbidity","Epidemiology","WHO","CDC"],
                  };
                  const preset = presets[industry] || [];
                  const isActive = preset.length > 0 && preset.every(w => hotwords.includes(w));
                  return (
                    <button key={industry} onClick={() => {
                      if (isActive) { const s = new Set(preset); saveHotwords(hotwords.filter(w => !s.has(w))); }
                      else { saveHotwords([...new Set([...hotwords, ...preset])]); }
                    }} className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${isActive ? "bg-[#5b8c15]/10 border-[#5b8c15]/40 text-[#5b8c15] font-medium" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-[#5b8c15]/5 hover:border-[#5b8c15]/30 hover:text-[#5b8c15]"}`}>
                      {isActive ? `✓ ${industry}` : industry}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="px-5 py-3 max-h-[40vh] overflow-y-auto">
              {hotwords.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No hotwords yet</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-slate-500">{hotwords.length} words</span>
                    <button onClick={() => saveHotwords([])} className="text-[11px] text-red-500 hover:text-red-600 font-medium transition-colors">Clear All</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hotwords.map((w) => (
                      <span key={w} className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-sm text-slate-700">
                        {w}
                        <button onClick={() => saveHotwords(hotwords.filter((h) => h !== w))} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100">
              <form onSubmit={(e) => { e.preventDefault(); const w = hotwordInput.trim(); if (w && !hotwords.includes(w)) { saveHotwords([...hotwords, w]); setHotwordInput(""); } }} className="flex gap-2">
                <input type="text" value={hotwordInput} onChange={(e) => setHotwordInput(e.target.value)} placeholder="e.g. Dify, JOTO, GPT-4o" className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]" />
                <button type="submit" className="px-3 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors">Add</button>
              </form>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowHotwords(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
