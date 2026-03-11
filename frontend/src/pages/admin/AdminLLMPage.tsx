import { useEffect, useState } from 'react';
import { Save, TestTube, Loader2 } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';
import { api } from '@/services/api';

const LLM_KEYS = ['llm_api_key', 'llm_base_url', 'llm_model', 'qwen_api_key'];

const KEY_LABELS: Record<string, string> = {
  llm_api_key: 'LLM API Key',
  llm_base_url: 'LLM Base URL',
  llm_model: 'LLM Model',
  qwen_api_key: 'Qwen API Key',
};

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
      if (LLM_KEYS.includes(s.key)) {
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
      // Only save fields that were changed (not masked values)
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
      const ragflow = health['ragflow'];
      if (ragflow?.status === 'ok') {
        setTestResult({ ok: true, message: `RAGFlow OK (${ragflow.latency_ms}ms)` });
      } else {
        setTestResult({ ok: false, message: ragflow?.message || 'RAGFlow connection failed' });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">LLM Configuration</h2>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
        {LLM_KEYS.map((key) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">{KEY_LABELS[key]}</label>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                getSource(key) === 'db'
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {getSource(key) === 'db' ? 'DB override' : 'env default'}
              </span>
            </div>
            <input
              type={key.includes('key') ? 'password' : 'text'}
              value={form[key] ?? ''}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder={KEY_LABELS[key]}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
            />
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isTesting ? <Loader2 size={16} className="animate-spin" /> : <TestTube size={16} />}
            Test Connection
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
    </div>
  );
}
