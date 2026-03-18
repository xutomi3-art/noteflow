import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2, Save } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

const SERVICE_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL',
  ragflow: 'RAGFlow',
  elasticsearch: 'Elasticsearch',
  redis: 'Redis',
  mineru: 'MinerU',
  docmee: 'Docmee AiPPT',
  qwen: 'Qwen3.5-Plus',
  google_oauth: 'Google OAuth',
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  postgresql: 'Primary database',
  ragflow: 'RAG retrieval engine',
  elasticsearch: 'Full-text search & vector index',
  redis: 'Cache & session store',
  mineru: 'Document parsing service',
  docmee: 'AI PPT generation service',
  qwen: 'Chat LLM, Embedding & Vision API',
  google_oauth: 'Google Sign-In connectivity (via proxy if configured)',
};

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  width?: string;
}

const SMTP_FIELDS: ConfigField[] = [
  { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
  { key: 'smtp_port', label: 'Port', placeholder: '465', width: 'w-24' },
  { key: 'smtp_user', label: 'Username', placeholder: 'user@example.com' },
  { key: 'smtp_password', label: 'Password', placeholder: 'password', secret: true },
  { key: 'smtp_from', label: 'From Address', placeholder: 'noreply@example.com' },
];

const GOOGLE_OAUTH_FIELDS: ConfigField[] = [
  { key: 'google_client_id', label: 'Google Client ID', placeholder: 'your-client-id.apps.googleusercontent.com' },
  { key: 'google_client_secret', label: 'Google Client Secret', placeholder: 'GOCSPX-...', secret: true },
  { key: 'google_redirect_uri', label: 'Redirect URI', placeholder: 'http://10.200.0.112/api/auth/google/callback' },
  { key: 'google_proxy', label: 'SOCKS5 Proxy', placeholder: 'socks5://user:pass@host:port (leave empty if direct)' },
];

const MICROSOFT_OAUTH_FIELDS: ConfigField[] = [
  { key: 'microsoft_client_id', label: 'Application (Client) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
  { key: 'microsoft_client_secret', label: 'Client Secret', placeholder: 'your-client-secret', secret: true },
  { key: 'microsoft_tenant_id', label: 'Tenant ID', placeholder: 'common (or your-tenant-id)' },
  { key: 'microsoft_redirect_uri', label: 'Redirect URI', placeholder: 'https://noteflow.jotoai.com/api/auth/microsoft/callback' },
];

const LLM_FIELDS: ConfigField[] = [
  { key: 'qwen_api_key', label: 'API Key', placeholder: 'sk-...', secret: true },
  { key: 'llm_base_url', label: 'Base URL', placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'llm_model', label: 'Model', placeholder: 'qwen3.5-plus' },
  { key: 'llm_max_output_tokens', label: 'Max Output Tokens', placeholder: '65536' },
];

const RAGFLOW_FIELDS: ConfigField[] = [
  { key: 'ragflow_api_key', label: 'API Key', placeholder: 'ragflow-...', secret: true },
  { key: 'ragflow_base_url', label: 'Base URL', placeholder: 'http://ragflow:9380' },
];

const DOCMEE_FIELDS: ConfigField[] = [
  { key: 'docmee_api_key', label: 'API Key', placeholder: 'your-docmee-api-key', secret: true },
];

interface ConfigSectionProps {
  title: string;
  description: string;
  fields: ConfigField[];
  settings: Array<{ key: string; value: string; source: string }>;
  saveSettings: (data: Record<string, string>) => Promise<void>;
  saveLabel: string;
}

function ConfigSection({ title, description, fields, settings, saveSettings, saveLabel }: ConfigSectionProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const values: Record<string, string> = {};
    for (const f of fields) {
      const found = settings.find((s) => s.key === f.key);
      values[f.key] = found?.value ?? '';
    }
    setForm(values);
  }, [settings, fields]);

  const getSource = (key: string): string => {
    const s = settings.find((s) => s.key === key);
    return s?.source ?? 'env';
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const changed: Record<string, string> = {};
      for (const [key, value] of Object.entries(form)) {
        if (!value.startsWith('****')) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        await saveSettings(changed);
      }
      setMessage(`${title} settings saved`);
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-0.5">{title}</h3>
      <p className="text-xs text-gray-400 mb-4">{description}</p>
      <div className="space-y-4">
        {fields.map(({ key, label, placeholder, secret, width }) => (
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
              value={form[key] ?? ''}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder={placeholder}
              className={`${width ?? 'w-full'} px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]`}
            />
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saveLabel}
          </button>
          {message && <span className="text-sm text-green-600">{message}</span>}
        </div>
      </div>
    </div>
  );
}

export default function AdminSystemPage() {
  const { health, settings, fetchHealth, fetchSettings, saveSettings, isLoading } = useAdminStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [maxFileSize, setMaxFileSize] = useState('');
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

  const handleSaveConfig = useCallback(async (data: Record<string, string>) => {
    await saveSettings(data);
    await fetchSettings();
  }, [saveSettings, fetchSettings]);

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

      {/* LLM (Qwen3.5-Plus) */}
      <ConfigSection
        title="LLM (Qwen3.5-Plus)"
        description="Unified Qwen API for chat, embedding, and vision"
        fields={LLM_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save LLM"
      />

      {/* RAGFlow */}
      <ConfigSection
        title="RAGFlow"
        description="Configure the RAGFlow retrieval engine connection"
        fields={RAGFLOW_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save RAGFlow"
      />

      {/* Docmee AiPPT */}
      <ConfigSection
        title="Docmee AiPPT"
        description="Configure the Docmee API for AI-powered PPT generation"
        fields={DOCMEE_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save Docmee"
      />

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
      <ConfigSection
        title="SMTP Email"
        description="Configure outgoing email for invite notifications"
        fields={SMTP_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save SMTP"
      />

      {/* Google OAuth Settings */}
      <ConfigSection
        title="Google OAuth"
        description="Configure Google Sign-In for users"
        fields={GOOGLE_OAUTH_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save Google OAuth"
      />

      {/* Microsoft OAuth Settings */}
      <ConfigSection
        title="Microsoft OAuth (Entra ID)"
        description="Configure Microsoft Sign-In for users (Azure AD / Entra ID)"
        fields={MICROSOFT_OAUTH_FIELDS}
        settings={settings}
        saveSettings={handleSaveConfig}
        saveLabel="Save Microsoft OAuth"
      />
    </div>
  );
}
