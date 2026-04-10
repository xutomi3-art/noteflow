import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Check } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/services/api';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, loadUser } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (trimmed === user?.name) return;

    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.updateProfile({ name: trimmed });
      await loadUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-slate-900">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 md:px-8 py-5 border-b border-slate-200 bg-white">
        <button
          onClick={() => navigate('/dashboard')}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      {/* Content */}
      <main className="max-w-[600px] mx-auto px-4 md:px-8 mt-8">
        {/* Profile Section */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#5b8c15] text-white flex items-center justify-center font-bold text-lg">
              {(name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <User className="w-4 h-4" />
                Profile
              </h2>
              <p className="text-sm text-slate-500">Manage your personal information</p>
            </div>
          </div>

          {/* Name field */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); setSaved(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20 transition-all"
              placeholder="Your name"
              maxLength={100}
            />
            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
          </div>

          {/* Email (read-only) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
            />
            <p className="mt-1.5 text-xs text-slate-400">Email cannot be changed</p>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || name.trim() === user?.name}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              saved
                ? 'bg-green-500 text-white'
                : name.trim() !== user?.name
                  ? 'bg-[#5b8c15] text-white hover:bg-[#4a7310]'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : saved ? (
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
            ) : 'Save Changes'}
          </button>
        </section>
      </main>
    </div>
  );
}
