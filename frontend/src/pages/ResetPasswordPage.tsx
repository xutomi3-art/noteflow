import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired reset link.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-700 mb-4">Invalid reset link.</p>
          <Link to="/forgot-password" className="text-[#5b8c15] font-medium hover:underline text-sm">
            Request a new one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <img src="/logo.png" alt="Noteflow" className="w-14 h-14 rounded-2xl mb-4 shadow-sm" />
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">New Password</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a strong password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-8">
          {success ? (
            <div className="text-center space-y-4">
              <div className="text-4xl">✅</div>
              <p className="text-sm text-gray-700">
                Password updated! Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-100">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                  New Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full h-11 px-4 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full h-11 px-4 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[#5b8c15] text-white text-sm font-medium transition-all hover:bg-[#4a7212] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Saving...
                  </div>
                ) : (
                  'Set New Password'
                )}
              </button>
            </form>
          )}
        </div>

        {!success && (
          <p className="text-center text-sm text-gray-500 mt-6">
            <Link to="/forgot-password" className="text-[#5b8c15] font-medium hover:underline">
              Request a new link
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
