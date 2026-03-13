import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, Save } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

const SERVICE_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL',
  ragflow: 'RAGFlow',
  elasticsearch: 'Elasticsearch',
  redis: 'Redis',
  mineru: 'MinerU',
  presenton: 'Presenton',
  deepseek: 'DeepSeek LLM',
  qwen: 'Qwen (Embedding)',
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  postgresql: 'Primary database',
  ragflow: 'RAG retrieval engine',
  elasticsearch: 'Full-text search & vector index',
  redis: 'Cache & session store',
  mineru: 'Document parsing service',
  presenton: 'AI slide deck generator',
  deepseek: 'Chat LLM API',
  qwen: 'Embedding & vision API',
};

const SMTP_FIELDS = [
  { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
  { key: 'smtp_port', label: 'Port', placeholder: '465', width: 'w-24' },
  { key: 'smtp_user', label: 'Username', placeholder: 'user@example.com' },
  { key: 'smtp_password', label: 'Password', placeholder: 'password', secret: true },
  { key: 'smtp_from', label: 'From Address', placeholder: 'noreply@example.com' },
];

const GOOGLE_OAUTH_FIELDS = [
  { key: 'google_client_id', label: 'Google Client ID', placeholder: 'your-client-id.apps.googleusercontent.com' },
  { key: 'google_client_secret', label: 'Google Client Secret', placeholder: 'GOCSPX-...', secret: true },
  { key: 'google_redirect_uri', label: 'Redirect URI', placeholder: 'http://10.200.0.112/api/auth/google/callback' },
];

export default function AdminSystemPage() {
  const { health, settings, fetchHealth, fetchSettings, saveSettings, isLoading } = useAdminStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [maxFileSize, setMaxFileSize] = useState('');
  const [smtpForm, setSmtpForm] = useState<Record<string, string>>({});
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState('');
  const [googleForm, setGoogleForm] = useState<Record<string, string>>({});
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleMessage, setGoogleMessage] = useState('');
  const [removeSelector, setRemoveSelector] = useState('');
  const [scraperSaving, setScraperSaving] = useState(false);
  const [scraperMessage, setScraperMessage] = useState('');

  useEffect(() => {
    fetchHealth();
    fetchSettings();
  }, [fetchHealth, fetchSettings]);

  useEffect(() => {
    const s = settings.find((s) => s.key === 'max_file_size_mb');
    if (s) setMaxFileSize(s.value);

    const smtp: Record<string, string> = {};
    for (const f of SMTP_FIELDS) {
      const found = settings.find((s) => s.key === f.key);
      smtp[f.key] = found?.value ?? '';
    }
    setSmtpForm(smtp);

    const google: Record<string, string> = {};
    for (const f of GOOGLE_OAUTH_FIELDS) {
      const found = settings.find((s) => s.key === f.key);
      google[f.key] = found?.value ?? '';
    }
    setGoogleForm(google);

    const scraper = settings.find((s) => s.key === 'web_scraper_remove_selector');
    if (scraper) setRemoveSelector(scraper.value);
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

  const handleSaveSmtp = async () => {
    setSmtpSaving(true);
    setSmtpMessage('');
    try {
      const changed: Record<string, string> = {};
      for (const [key, value] of Object.entries(smtpForm)) {
        if (!value.startsWith('****')) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        await saveSettings(changed);
      }
      setSmtpMessage('SMTP settings saved');
      setTimeout(() => setSmtpMessage(''), 3000);
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleSaveGoogle = async () => {
    setGoogleSaving(true);
    setGoogleMessage('');
    try {
      const changed: Record<string, string> = {};
      for (const [key, value] of Object.entries(googleForm)) {
        if (!value.startsWith('****')) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        await saveSettings(changed);
      }
      setGoogleMessage('Google OAuth settings saved');
      setTimeout(() => setGoogleMessage(''), 3000);
    } finally {
      setGoogleSaving(false);
    }
  };

  const handleSaveScraper = async () => {
    setScraperSaving(true);
    setScraperMessage('');
    try {
      await saveSettings({ web_scraper_remove_selector: removeSelector });
      setScraperMessage('Web scraper settings saved');
      setTimeout(() => setScraperMessage(''), 3000);
    } finally {
      setScraperSaving(false);
    }
  };

  const getSource = (key: string): string => {
    const s = settings.find((s) => s.key === key);
    return s?.source ?? 'env';
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Service Health</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {Object.keys(health).length > 0
                ? `${Object.values(health).filter(h => h.status === 'ok').length}/${Object.keys(health).length} services healthy`
                : 'Click Refresh to check'}
            </p>
          </div>
          {Object.keys(health).length > 0 && (
            <div className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              Object.values(health).every(h => h.status === 'ok')
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {Object.values(health).every(h => h.status === 'ok') ? 'All Healthy' : 'Issues Detected'}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {(Object.keys(SERVICE_LABELS) as string[]).map((key) => {
            const h = health[key];
            if (!h && Object.keys(health).length === 0) return null;
            return (
              <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      !h ? 'bg-gray-300' : h.status === 'ok' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {SERVICE_LABELS[key] || key}
                    </div>
                    <div className="text-xs text-gray-400">
                      {SERVICE_DESCRIPTIONS[key] || ''}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  {h ? (
                    <>
                      <div className={`text-xs font-medium ${h.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                        {h.status === 'ok' ? 'Healthy' : 'Error'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {h.status === 'ok' ? `${h.latency_ms}ms` : (h.message || 'Unreachable')}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-400">—</div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Show any extra services not in SERVICE_LABELS */}
          {Object.entries(health)
            .filter(([key]) => !(key in SERVICE_LABELS))
            .map(([key, h]) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${h.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="text-sm font-medium text-gray-900">{key}</div>
                </div>
                <div className="text-xs text-gray-400">
                  {h.status === 'ok' ? `${h.latency_ms}ms` : (h.message || 'Error')}
                </div>
              </div>
            ))}
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

      {/* Web Scraper Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-0.5">Web Scraper</h3>
        <p className="text-xs text-gray-400 mb-4">
          URL sources use Jina Reader for clean markdown extraction. Configure CSS selectors to remove unwanted elements (ads, sidebars, etc.)
        </p>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700">Remove Selectors</label>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              getSource('web_scraper_remove_selector') === 'db'
                ? 'bg-blue-50 text-blue-600'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {getSource('web_scraper_remove_selector') === 'db' ? 'DB override' : 'env default'}
            </span>
          </div>
          <textarea
            value={removeSelector}
            onChange={(e) => setRemoveSelector(e.target.value)}
            placeholder="nav, footer, header, aside, .ads, .sidebar, .advertisement"
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Comma-separated CSS selectors. These elements will be removed from all scraped web pages before content extraction.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-3">
          <button
            onClick={handleSaveScraper}
            disabled={scraperSaving}
            className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
          >
            {scraperSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
          {scraperMessage && <span className="text-sm text-green-600">{scraperMessage}</span>}
        </div>
      </div>

      {/* SMTP Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-0.5">SMTP Email</h3>
        <p className="text-xs text-gray-400 mb-4">Configure outgoing email for invite notifications</p>
        <div className="space-y-4">
          {SMTP_FIELDS.map(({ key, label, placeholder, secret, width }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">{label}</label>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  getSource(key) === 'db'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {getSource(key) === 'db' ? 'DB override' : 'env default'}
                </span>
              </div>
              <input
                type={secret ? 'password' : 'text'}
                value={smtpForm[key] ?? ''}
                onChange={(e) => setSmtpForm({ ...smtpForm, [key]: e.target.value })}
                placeholder={placeholder}
                className={`${width ?? 'w-full'} px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]`}
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSaveSmtp}
              disabled={smtpSaving}
              className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
            >
              {smtpSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save SMTP
            </button>
            {smtpMessage && <span className="text-sm text-green-600">{smtpMessage}</span>}
          </div>
        </div>
      </div>

      {/* Google OAuth Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-0.5">Google OAuth</h3>
        <p className="text-xs text-gray-400 mb-4">Configure Google Sign-In for users</p>
        <div className="space-y-4">
          {GOOGLE_OAUTH_FIELDS.map(({ key, label, placeholder, secret }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">{label}</label>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  getSource(key) === 'db'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {getSource(key) === 'db' ? 'DB override' : 'env default'}
                </span>
              </div>
              <input
                type={secret ? 'password' : 'text'}
                value={googleForm[key] ?? ''}
                onChange={(e) => setGoogleForm({ ...googleForm, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSaveGoogle}
              disabled={googleSaving}
              className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
            >
              {googleSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Google OAuth
            </button>
            {googleMessage && <span className="text-sm text-green-600">{googleMessage}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
