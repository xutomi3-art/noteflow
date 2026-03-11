import { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

const SERVICE_LABELS: Record<string, string> = {
  ragflow: 'RAGFlow',
  mineru: 'MinerU',
  postgresql: 'PostgreSQL',
};

export default function AdminSystemPage() {
  const { health, settings, fetchHealth, fetchSettings, saveSettings, isLoading } = useAdminStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [maxFileSize, setMaxFileSize] = useState('');

  useEffect(() => {
    fetchHealth();
    fetchSettings();
  }, [fetchHealth, fetchSettings]);

  useEffect(() => {
    const s = settings.find((s) => s.key === 'max_file_size_mb');
    if (s) setMaxFileSize(s.value);
  }, [settings]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchHealth();
    setIsRefreshing(false);
  };

  const handleSaveMaxFileSize = async () => {
    if (maxFileSize) {
      await saveSettings({ max_file_size_mb: maxFileSize });
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900">System</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Service Health */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Service Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(health).map(([key, h]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  h.status === 'ok' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {SERVICE_LABELS[key] || key}
                </div>
                <div className="text-xs text-gray-400">
                  {h.status === 'ok'
                    ? `${h.latency_ms}ms`
                    : h.message || 'Error'}
                </div>
              </div>
            </div>
          ))}
          {Object.keys(health).length === 0 && !isLoading && (
            <p className="text-sm text-gray-400 col-span-3">Click Refresh to check services</p>
          )}
        </div>
      </div>

      {/* File Upload Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">File Upload</h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">Max file size (MB)</label>
            <input
              type="number"
              value={maxFileSize}
              onChange={(e) => setMaxFileSize(e.target.value)}
              className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
            />
          </div>
          <button
            onClick={handleSaveMaxFileSize}
            className="px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* SMTP Settings (placeholder) */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">SMTP Email</h3>
        <p className="text-sm text-gray-400">
          Email settings are configured via environment variables. See docker-compose.yml for SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM.
        </p>
      </div>
    </div>
  );
}
