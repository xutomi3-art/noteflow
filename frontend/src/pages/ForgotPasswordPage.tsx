import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <img src="/logo.png" alt="Noteflow" className="w-14 h-14 rounded-2xl mb-4 shadow-sm" />
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Reset Password</h1>
          <p className="text-sm text-gray-500 mt-1">We'll send you a reset link</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-8">
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="text-4xl">📬</div>
              <p className="text-sm text-gray-700 leading-relaxed">
                If <strong>{email}</strong> is registered, you'll receive a password reset link shortly.
                Check your inbox (and spam folder).
              </p>
              <Link
                to="/login"
                className="block text-[#5b8c15] text-sm font-medium hover:underline mt-2"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-100">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
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
                    Sending...
                  </div>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          )}
        </div>

        {!submitted && (
          <p className="text-center text-sm text-gray-500 mt-6">
            Remember your password?{' '}
            <Link to="/login" className="text-[#5b8c15] font-medium hover:underline">
              Sign In
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
