import { useEffect, useState } from 'react';
import { Save, TestTube, Loader2 } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';
import { api } from '@/services/api';

interface FieldGroup {
  title: string;
  description: string;
  fields: { key: string; label: string; secret?: boolean }[];
}

const GROUPS: FieldGroup[] = [
  {
    title: 'Qwen3.5-Plus (Chat LLM)',
    description: 'Unified Qwen API for chat, embedding, and vision',
    fields: [
      { key: 'qwen_api_key', label: 'API Key', secret: true },
      { key: 'llm_base_url', label: 'Base URL' },
      { key: 'llm_model', label: 'Model' },
      { key: 'llm_max_output_tokens', label: 'Max Output Tokens' },
    ],
  },
  {
    title: 'RAGFlow',
    description: 'Self-hosted RAG retrieval engine',
    fields: [
      { key: 'ragflow_api_key', label: 'API Key', secret: true },
      { key: 'ragflow_base_url', label: 'Base URL' },
      { key: 'rag_top_k', label: 'Top-K Chunks (default: 6)' },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export default function AdminLLMPage() {
  const { settings, fetchSettings, saveSettings, isLoading } = useAdminStore();
  const [form, setForm] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const s of settings) {
      if (ALL_KEYS.includes(s.key)) {
        initial[s.key] = s.value;
      }
    }
    setForm(initial);
  }, [settings]);

  const getSource = (key: string): string => {
    const s = settings.find((s) => s.key === key);
    return s?.source ?? 'env';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');
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
      setSaveMessage('Settings saved successfully');
      setTimeout(() => setSaveMessage(''), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const health = await api.getAdminHealth();
      const results: string[] = [];
      for (const [key, h] of Object.entries(health)) {
        results.push(`${key}: ${h.status === 'ok' ? `OK (${h.latency_ms}ms)` : h.message || 'Error'}`);
      }
      const allOk = Object.values(health).every((h) => h.status === 'ok');
      setTestResult({ ok: allOk, message: results.join(' | ') });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">LLM & Services</h2>

      {GROUPS.map((group) => (
        <div key={group.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{group.title}</h3>
          <p className="text-xs text-gray-400 mb-4">{group.description}</p>
          <div className="space-y-4">
            {group.fields.map(({ key, label, secret }) => (
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
                  placeholder={label}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Token Budget Info */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Token Budget</h3>
        <p className="text-xs text-gray-500 mb-4">
          Model: <span className="font-medium text-gray-700">Qwen3.5-Plus</span> &middot; Context: <span className="font-medium text-gray-700">1,000,000 tokens</span> &middot; Max Output: <span className="font-medium text-gray-700">65,536 tokens</span>
        </p>

        {/* Budget Allocation */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">Current Allocation</p>
          <div className="space-y-1.5">
            {[
              { label: "System Prompt", tokens: "~1K", pct: 0.1, color: "bg-slate-400" },
              { label: "Chat History", tokens: "~30K (30 rounds)", pct: 3, color: "bg-blue-400" },
              { label: "RAG Context", tokens: "~20K (top-10 chunks)", pct: 2, color: "bg-emerald-400" },
              { label: "Excel Context (dynamic)", tokens: "~100-300K", pct: 20, color: "bg-amber-400" },
            ].map(({ label, tokens, pct, color }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-[120px] text-xs text-gray-600 truncate">{label}</div>
                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(pct, 1)}%` }} />
                </div>
                <div className="w-[130px] text-xs text-gray-500 text-right">{tokens}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-[120px] text-xs text-gray-600 truncate">Total Cap</div>
            <div className="text-xs text-gray-500">Normal: <span className="font-medium text-gray-700">~250K tokens</span> &middot; With Excel: <span className="font-medium text-gray-700">~800K tokens</span></div>
          </div>
        </div>

        {/* Pricing */}
        <div className="border-t border-gray-200 pt-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">Pricing (per million tokens)</p>
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-gray-500">
            <span>&le;128K:</span><span>&yen;0.8 input</span><span>&yen;4.8 output</span>
            <span>128K&ndash;256K:</span><span>&yen;2.0 input</span><span>&yen;12 output</span>
            <span>256K&ndash;1M:</span><span>&yen;4.0 input</span><span>&yen;24 output</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save All
        </button>
        <button
          onClick={handleTest}
          disabled={isTesting}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {isTesting ? <Loader2 size={16} className="animate-spin" /> : <TestTube size={16} />}
          Test Connections
        </button>
      </div>

      {saveMessage && (
        <p className="text-sm text-green-600">{saveMessage}</p>
      )}
      {testResult && (
        <p className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
          {testResult.message}
        </p>
      )}
    </div>
  );
}
