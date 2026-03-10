import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Files, Plus, User, Users, ChevronRight, X, Upload, LogOut, Star } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useNotebookStore } from '@/stores/notebook-store';
import type { Notebook } from '@/types/api';

const EMOJIS = ['📝', '🚀', '🔬', '📈', '💡', '💰', '⚡', '🎨', '🏷️', '📋', '⚙️', '📅', '🌟', '🎯', '📚', '🧪', '🔥', '🌈', '🎵', '🧠'];
const COLORS = ['#ecfccb', '#dbeafe', '#d1fae5', '#fef08a', '#fed7aa', '#f3e8ff', '#cffafe', '#fce7f3', '#e0e7ff', '#ffedd5'];

function randomEmoji(): string {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
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
  const { notebooks, fetchNotebooks, createNotebook } = useNotebookStore();

  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showAllPersonal, setShowAllPersonal] = useState(false);
  const [showAllTeam, setShowAllTeam] = useState(false);
  const [createModalType, setCreateModalType] = useState<'personal' | 'team' | null>(null);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [memberEmail, setMemberEmail] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  const personalNotebooks = notebooks.filter(
    (nb) => nb.user_role === 'owner' && !nb.is_shared
  );
  const teamNotebooks = notebooks.filter(
    (nb) => nb.is_shared || nb.user_role !== 'owner'
  );

  const sortedPersonal = [...personalNotebooks].sort(
    (a, b) => (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0)
  );
  const sortedTeam = [...teamNotebooks].sort(
    (a, b) => (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0)
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
      return next;
    });
  };

  const closeModal = () => {
    setCreateModalType(null);
    setCreateStep(1);
    setMemberEmail('');
    setEmails([]);
  };

  const handleAddEmail = () => {
    const trimmedEmail = memberEmail.trim();
    if (trimmedEmail && !emails.includes(trimmedEmail)) {
      setEmails([...emails, trimmedEmail]);
      setMemberEmail('');
    }
  };

  const handleOpenNotebook = (notebook: Notebook) => {
    navigate('/notebook/' + notebook.id);
  };

  const handleCreatePersonal = async () => {
    try {
      const notebook = await createNotebook({
        name: 'New Notebook',
        emoji: randomEmoji(),
        cover_color: randomColor(),
        is_team: false,
      });
      closeModal();
      navigate('/notebook/' + notebook.id);
    } catch {
      // Error handled by store
    }
  };

  const handleCreateTeam = async () => {
    try {
      const notebook = await createNotebook({
        name: 'New Team Notebook',
        emoji: randomEmoji(),
        cover_color: randomColor(),
        is_team: true,
      });
      closeModal();
      navigate('/notebook/' + notebook.id);
    } catch {
      // Error handled by store
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
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="bg-[#5b8c15] p-2 rounded-xl">
            <Files className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tight">Noteflow</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
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
      <main className="max-w-[1200px] mx-auto px-8 mt-8">
        {/* Personal Notebooks Section */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6 relative">
            <h2 className="text-[28px] font-bold tracking-tight">Personal Notebooks</h2>
            <div
              className="relative"
              onMouseEnter={() => setIsCreateMenuOpen(true)}
              onMouseLeave={() => setIsCreateMenuOpen(false)}
            >
              <button className="flex items-center gap-2 bg-[#5b8c15] hover:bg-[#4a7311] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm">
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

          {personalNotebooks.length === 0 ? (
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
                    style={{ backgroundColor: notebook.cover_color }}
                  >
                    <button
                      onClick={(e) => toggleStarred(notebook.id, e)}
                      className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-white transition-colors z-10"
                    >
                      <Star className={`w-3.5 h-3.5 ${starredIds.has(notebook.id) ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                    </button>
                    {notebook.emoji}
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-base mb-1.5 truncate text-slate-900">{notebook.name}</h3>
                    <div className="text-[13px] text-slate-500 font-medium">
                      {formatRelativeDate(notebook.created_at)} <span className="mx-1.5 text-slate-300">&bull;</span> {notebook.source_count} sources
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {personalNotebooks.length > 4 && (
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
          <h2 className="text-[28px] font-bold tracking-tight mb-6">Team Notebooks</h2>

          {teamNotebooks.length === 0 ? (
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
                    className="h-36 relative flex items-center justify-center text-5xl group-hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: notebook.cover_color }}
                  >
                    <div className="absolute top-4 left-4 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-white/90 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 shadow-sm">
                        <Users className="w-3.5 h-3.5" /> {notebook.member_count}
                      </div>
                    </div>
                    <button
                      onClick={(e) => toggleStarred(notebook.id, e)}
                      className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm hover:bg-white transition-colors z-10"
                    >
                      <Star className={`w-3.5 h-3.5 ${starredIds.has(notebook.id) ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                    </button>
                    {notebook.emoji}
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-base mb-1.5 truncate text-slate-900">{notebook.name}</h3>
                    <div className="text-[13px] text-slate-500 font-medium">
                      {notebook.user_role !== 'owner' ? `Shared with you` : `${notebook.member_count} members`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {teamNotebooks.length > 4 && (
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
          <div>&copy; 2026 AVACA AI. All rights reserved.</div>
          <div className="flex items-center gap-8 mt-4 md:mt-0">
            <a href="#" className="hover:text-slate-900 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-900 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-slate-900 transition-colors">Help Center</a>
          </div>
        </footer>
      </main>

      {/* Create Modal */}
      {createModalType && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-2xl p-10 relative shadow-2xl">
            <button
              onClick={closeModal}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="text-center mb-8">
              <h2 className="text-[32px] font-bold text-slate-900 leading-tight">
                {createModalType === 'team' && createStep === 2 ? 'Invite your team members' : 'Create a Notebook from'}
              </h2>
              {!(createModalType === 'team' && createStep === 2) && (
                <h2 className="text-[32px] font-bold text-[#a3e635] leading-tight">your documents</h2>
              )}
            </div>

            {createModalType === 'team' && createStep === 2 ? (
              <div className="mb-6 flex flex-col items-center">
                <div className="w-full max-w-md flex flex-col gap-3">
                  <div className="flex items-center gap-2 bg-white border border-slate-200 p-1 rounded-xl shadow-sm w-full h-[44px]">
                    <input
                      type="email"
                      placeholder="Enter email address..."
                      className="flex-1 text-sm px-3 py-1.5 outline-none bg-transparent"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          handleAddEmail();
                        }
                      }}
                    />
                    <button
                      onClick={handleAddEmail}
                      className="bg-[#5b8c15] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-[#4a7311] transition-colors h-full"
                    >
                      Add
                    </button>
                  </div>

                  {/* Email Chips */}
                  {emails.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {emails.map((email) => (
                        <div key={email} className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200">
                          {email}
                          <button
                            onClick={() => setEmails(emails.filter((e) => e !== email))}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleCreateTeam}
                    className="mt-4 w-full bg-[#5b8c15] text-white py-3 rounded-xl font-semibold hover:bg-[#4a7311] transition-colors shadow-sm"
                  >
                    Finish & Open Notebook
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="border-2 border-dashed border-slate-200 rounded-3xl p-12 flex flex-col items-center justify-center text-center bg-slate-50/50">
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Drag & drop your files here</h3>
                  <p className="text-sm text-slate-500 mb-8">PDF, DOCX, PPTX, TXT, MD, EXCEL, CSV, Image..</p>
                  <button
                    onClick={() => {
                      if (createModalType === 'team') {
                        setCreateStep(2);
                      } else {
                        handleCreatePersonal();
                      }
                    }}
                    className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-semibold hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    <Upload className="w-5 h-5" />
                    {createModalType === 'team' ? 'Upload & Next' : 'Upload files'}
                  </button>
                </div>
                {createModalType === 'team' && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={() => setCreateStep(2)}
                      className="text-sm font-semibold text-[#5b8c15] hover:underline"
                    >
                      Next step
                    </button>
                  </div>
                )}
                <p className="text-center text-xs text-slate-400 mt-6">Up to 50 files, 50 MB each.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
