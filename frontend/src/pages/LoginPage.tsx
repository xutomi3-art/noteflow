import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuthStore } from '@/stores/auth-store';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const setTokens = useAuthStore(s => s.setTokens);
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) setError(decodeURIComponent(urlError));
  }, [searchParams]);

  // Microsoft OAuth via popup — avoids ms-sso.copilot.microsoft.com
  // redirect that is blocked in China (ERR_CONNECTION_RESET)
  const handleMicrosoftLogin = useCallback(() => {
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      '/api/auth/microsoft',
      'microsoft-login',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`
    );

    // Poll for callback completion
    const interval = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(interval);
          return;
        }
        const url = popup.location.href;
        if (url.includes('/auth/callback')) {
          const params = new URL(url).searchParams;
          const token = params.get('token');
          const refresh = params.get('refresh');
          if (token && refresh) {
            clearInterval(interval);
            popup.close();
            setTokens(token, refresh).then(() => {
              const redirect = searchParams.get('redirect') || '/dashboard';
              navigate(redirect, { replace: true });
            });
          }
        }
      } catch {
        // Cross-origin — popup is still on Microsoft's domain, keep polling
      }
    }, 300);
  }, [setTokens, navigate, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      const redirect = searchParams.get('redirect') || '/dashboard';
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo & Branding */}
        <div className="flex flex-col items-center mb-10">
          <img src="/logo.png" alt="Noteflow" className="w-14 h-14 rounded-2xl mb-4 shadow-sm" />
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Noteflow</h1>
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#5b8c15]/10 text-[#5b8c15] rounded-md">Beta</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-8">
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
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-11 px-4 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link to="/forgot-password" className="text-xs text-[#5b8c15] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
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
                  Signing in...
                </div>
              ) : (
                'Sign In'
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Microsoft Sign-In */}
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
            >
              <svg width="18" height="18" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z"/>
                <path fill="#81bc06" d="M12 1h10v10H12z"/>
                <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                <path fill="#ffba08" d="M12 12h10v10H12z"/>
              </svg>
              Sign in with Microsoft
            </button>
          </form>
        </div>

        {/* Footer link */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Don't have an account?{' '}
          <Link
            to={searchParams.get('redirect') ? `/register?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/register'}
            className="text-[#5b8c15] font-medium hover:underline"
          >
            Create one
          </Link>
        </p>

      </div>

      <p className="absolute bottom-6 text-center text-xs text-gray-400">
        上海聚托信息科技有限公司©2026{' '}
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">沪ICP备15056478号-5</a>
      </p>
    </div>
  );
}
