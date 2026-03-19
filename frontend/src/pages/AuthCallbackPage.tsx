import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore(s => s.setTokens);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const error = searchParams.get('error');
    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');

    if (!token || !refresh) {
      navigate('/login?error=Missing+tokens', { replace: true });
      return;
    }

    setTokens(token, refresh)
      .then(() => {
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        navigate('/login?error=Authentication+failed', { replace: true });
      });
  }, [searchParams, setTokens, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#5b8c15] border-t-transparent" />
        <p className="text-sm text-gray-500">Completing sign in...</p>
      </div>
    </div>
  );
}
