import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, User, Users, ChevronRight, X, Upload, LogOut, Star, FileText, Loader2, Shield, Trash2, Globe, Link as LinkIcon } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useNotebookStore } from '@/stores/notebook-store';
import { setPendingUploadFiles, setPendingUploadUrls } from '@/stores/pending-upload-store';
import type { Notebook } from '@/types/api';
import ShareModal from '@/components/sharing/ShareModal';

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
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[date.getMonth()]}`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { notebooks, isLoading, fetchNotebooks, createNotebook, deleteNotebook } = useNotebookStore();

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [notebookName, setNotebookName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [pendingUrls, setPendingUrlsList] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const sortedTeam = [...teamNotebooks].sort(
    (a, b) => {
      const starDiff = (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0);
      if (starDiff !== 0) return starDiff;
      return teamNotebooks.indexOf(a) - teamNotebooks.indexOf(b);
    }
  );

  const displayedPersonal = showAllPersonal ? sortedPersonal : sortedPersonal.slice(0, 4);
  const displayedTeam = showAllTeam ? sortedTeam : sortedTeam.slice(0, 4);

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
    setIsCreating(false);
  };

  const handleOpenNotebook = (notebook: Notebook) => {
    navigate('/notebook/' + notebook.id);
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of newFiles) {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        accepted.push(file);
      }
    }
    if (rejected.length > 0) {
      alert(`The following files exceed the 50 MB limit and were skipped:\n\n${rejected.join('\n')}`);
    }
    if (pendingFiles.length + accepted.length > 50) {
      alert('Maximum 50 files allowed per notebook.');
      return;
    }
    setPendingFiles(prev => [...prev, ...accepted]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    try { new URL(url); } catch {
      setUrlError('Please enter a valid URL starting with http:// or https://');
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
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden md:block">
            <div className="font-semibold text-sm">{userName}</div>
            <div className="text-xs text-slate-500">{user?.email}</div>
          </div>
          <div
            className="relative"
            onMouseEnter={() => setIsProfileMenuOpen(true)}
            onMouseLeave={() => setIsProfileMenuOpen(false)}
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
                  className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer group relative"
                >
                  <div
                    className="h-36 flex items-center justify-center text-5xl group-hover:opacity-90 transition-opacity relative"
                    style={{ backgroundColor: cardColor(notebook) }}
                  >
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      <button
                        onClick={(e) => handleDeleteNotebook(notebook, e)}
                        className="bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete notebook"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                      </button>
                      <button
                        onClick={(e) => toggleStarred(notebook.id, e)}
                        className="bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-white transition-colors"
                      >
                        <Star className={`w-3.5 h-3.5 ${starredIds.has(notebook.id) ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                      </button>
                    </div>
                    <span className="text-6xl drop-shadow-sm">{notebook.emoji}</span>
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-base mb-1.5 truncate text-slate-900">{notebook.name}</h3>
                    <div className="text-[13px] text-slate-500 font-medium">
                      {formatRelativeDate(notebook.created_at)} <span className="mx-1.5 text-slate-300">&bull;</span> {notebook.source_count} {notebook.source_count === 1 ? 'source' : 'sources'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {personalNotebooks.length > 6 && (
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {displayedTeam.map((notebook) => (
                <div
                  key={notebook.id}
                  onClick={() => handleOpenNotebook(notebook)}
                  className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer group relative"
                >
                  <div
                    className="h-36 relative flex items-center justify-center group-hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: cardColor(notebook) }}
                  >
                    <div className="absolute top-4 left-4 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-white/90 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 shadow-sm">
                        <Users className="w-3.5 h-3.5" /> {notebook.member_count}
                      </div>
                    </div>
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      {notebook.user_role === 'owner' && (
                        <button
                          onClick={(e) => handleDeleteNotebook(notebook, e)}
                          className="bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete notebook"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                        </button>
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
                  <div className="p-5">
                    <h3 className="font-bold text-base mb-1.5 truncate text-slate-900">{notebook.name}</h3>
                    <div className="text-[13px] text-slate-500 font-medium">
                      {notebook.user_role !== 'owner' ? `Shared with you` : `${notebook.member_count} ${notebook.member_count === 1 ? 'member' : 'members'}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {teamNotebooks.length > 6 && (
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
              accept=".pdf,.docx,.pptx,.txt,.md,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp"
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
                    pdf, images, docs,{' '}
                    <span className="relative group/tip inline-block">
                      <span className="underline decoration-dotted underline-offset-2 cursor-default">and more</span>
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-slate-900 text-white text-xs leading-relaxed px-3 py-2.5 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 z-50 shadow-lg">
                        Supported file types: pdf, txt, md, docx, pptx, xlsx, xls, csv, jpg, jpeg, png, webp, gif, bmp
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
                          placeholder="https://example.com"
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
                          <span className="text-xs text-slate-400 shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
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
                <p className="text-center text-xs text-slate-400 mt-4">Up to 50 files, 50 MB each.</p>
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
    </div>
  );
}
