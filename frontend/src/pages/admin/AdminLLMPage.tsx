import { useEffect, useState, useMemo, useCallback } from 'react';
import { Save, TestTube, Loader2, Database } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';
import { api } from '@/services/api';

interface FieldGroup {
  title: string;
  description: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
}

const GROUPS: FieldGroup[] = [
  {
    title: 'LLM (Chat Model)',
    description: 'Any OpenAI-compatible API — Qwen, GPT, DeepSeek, Claude, etc.',
    fields: [
      { key: 'qwen_api_key', label: 'API Key', secret: true },
      { key: 'llm_base_url', label: 'Base URL', placeholder: 'e.g. https://api.openai.com/v1' },
      { key: 'llm_model', label: 'Model', placeholder: 'e.g. gpt-4o, qwen3.5-plus, deepseek-chat' },
      { key: 'llm_context_window', label: 'Context Window (tokens)', placeholder: 'e.g. 128000, 256000, 1000000' },
      { key: 'llm_max_output_tokens', label: 'Max Output Tokens', placeholder: 'e.g. 8192' },
    ],
  },
  {
    title: 'RAGFlow',
    description: 'Self-hosted RAG retrieval engine',
    fields: [
      { key: 'ragflow_api_key', label: 'API Key', secret: true },
      { key: 'ragflow_base_url', label: 'Base URL' },
      { key: 'rag_top_k', label: 'Top-K Chunks', placeholder: 'default: 8' },
      { key: 'rag_similarity_threshold', label: 'Similarity Threshold', placeholder: 'default: 0.0 (0.0–1.0, lower = more results)' },
      { key: 'rag_vector_weight', label: 'Vector Weight', placeholder: 'default: 0.7 (0.0–1.0, higher = more semantic)' },
      { key: 'rag_rewrite_model', label: 'Query Rewrite Model', placeholder: 'default: qwen-turbo (fast, for keyword rewriting)' },
      { key: 'rag_decompose_model', label: 'Deep Think Model', placeholder: 'empty = use main model (for CoT query decomposition)' },
      { key: 'rag_think_rounds', label: 'Deep Think Rounds', placeholder: 'default: 5 (max ReAct search rounds)' },
      { key: 'rag_rerank_id', label: 'Rerank Model (Retrieval API)', placeholder: 'default: gte-rerank (used in RAGFlow retrieval calls)' },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function AdminLLMPage() {
  const { settings, fetchSettings, saveSettings, isLoading } = useAdminStore();
  const [form, setForm] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMessage, setSaveMessage] = useState('');

  // RAGFlow internal models (separate API)
  const [ragflowModels, setRagflowModels] = useState<Record<string, string>>({});
  const [ragflowForm, setRagflowForm] = useState<Record<string, string>>({});
  const [ragflowLoading, setRagflowLoading] = useState(false);
  const [ragflowSaving, setRagflowSaving] = useState(false);
  const [ragflowMessage, setRagflowMessage] = useState('');
  const [ragflowError, setRagflowError] = useState('');

  const fetchRagflowModels = useCallback(async () => {
    setRagflowLoading(true);
    setRagflowError('');
    try {
      const data = await api.getRagflowModels();
      setRagflowModels(data);
      setRagflowForm(data);
    } catch (e) {
      setRagflowError(e instanceof Error ? e.message : 'Failed to load RAGFlow models');
    } finally {
      setRagflowLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchRagflowModels();
  }, [fetchSettings, fetchRagflowModels]);

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

  // Compute dynamic token budget from context window
  const budget = useMemo(() => {
    const contextWindow = parseInt(form.llm_context_window || '0') || 128000;
    const maxOutput = parseInt(form.llm_max_output_tokens || '0') || 8192;
    const topK = parseInt(form.rag_top_k || '0') || 15;

    const systemPrompt = 1000;
    const historyBudget = Math.min(Math.round(contextWindow * 0.06), 60000); // ~6% for history
    const ragBudget = topK * 1500; // ~1500 tokens per chunk
    const excelBudget = Math.min(Math.round(contextWindow * 0.4), 600000);
    const normalCap = Math.round(contextWindow * 0.25);
    const excelCap = Math.round(contextWindow * 0.8);

    return { contextWindow, maxOutput, systemPrompt, historyBudget, ragBudget, excelBudget, normalCap, excelCap, topK };
  }, [form.llm_context_window, form.llm_max_output_tokens, form.rag_top_k]);

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

  const handleSaveRagflow = async () => {
    setRagflowSaving(true);
    setRagflowMessage('');
    setRagflowError('');
    try {
      const changed: Record<string, string> = {};
      for (const [key, value] of Object.entries(ragflowForm)) {
        if (value !== ragflowModels[key]) {
          changed[key] = value;
        }
      }
      if (Object.keys(changed).length > 0) {
        const updated = await api.updateRagflowModels(changed);
        setRagflowModels(updated);
        setRagflowForm(updated);
      }
      setRagflowMessage('RAGFlow models updated');
      setTimeout(() => setRagflowMessage(''), 3000);
    } catch (e) {
      setRagflowError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setRagflowSaving(false);
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

  const budgetRows = [
    { label: "System Prompt", tokens: budget.systemPrompt, color: "bg-slate-400" },
    { label: "Chat History", tokens: budget.historyBudget, color: "bg-blue-400" },
    { label: `RAG Context (top-${budget.topK})`, tokens: budget.ragBudget, color: "bg-emerald-400" },
    { label: "Excel Context", tokens: budget.excelBudget, color: "bg-amber-400" },
    { label: "Max Output", tokens: budget.maxOutput, color: "bg-purple-400" },
  ];
  const totalBudget = budgetRows.reduce((sum, r) => sum + r.tokens, 0);

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">LLM & Services</h2>

      {GROUPS.map((group) => (
        <div key={group.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{group.title}</h3>
          <p className="text-xs text-gray-400 mb-4">{group.description}</p>
          <div className="space-y-4">
            {group.fields.map(({ key, label, secret, placeholder }) => (
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
                  placeholder={placeholder || label}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* RAGFlow Internal Models — separate API */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-0.5">
          <Database size={16} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">RAGFlow Internal Models</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Models used by RAGFlow internally for chunk processing (keyword generation, embedding, reranking).
          These are stored in RAGFlow&apos;s database, not in Noteflow settings.
        </p>
        {ragflowError && (
          <p className="text-sm text-red-600 mb-3">{ragflowError}</p>
        )}
        {ragflowLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {[
                { key: 'llm_id', label: 'Chunk Processing LLM', placeholder: 'e.g. qwen-plus (for auto_keywords/questions & RAPTOR)' },
                { key: 'embd_id', label: 'Embedding Model', placeholder: 'e.g. text-embedding-v3' },
                { key: 'rerank_id', label: 'Rerank Model', placeholder: 'e.g. gte-rerank@Tongyi-Qianwen' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">{label}</label>
                  <input
                    type="text"
                    value={ragflowForm[key] ?? ''}
                    onChange={(e) => setRagflowForm({ ...ragflowForm, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleSaveRagflow}
                disabled={ragflowSaving}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
              >
                {ragflowSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save RAGFlow Models
              </button>
              {ragflowMessage && (
                <span className="text-sm text-green-600">{ragflowMessage}</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Token Budget — auto-calculated */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Token Budget (auto-calculated)</h3>
        <p className="text-xs text-gray-500 mb-4">
          Model: <span className="font-medium text-gray-700">{form.llm_model || '-'}</span>
          {' '}&middot; Context Window: <span className="font-medium text-gray-700">{formatTokens(budget.contextWindow)} tokens</span>
          {' '}&middot; Max Output: <span className="font-medium text-gray-700">{formatTokens(budget.maxOutput)} tokens</span>
        </p>

        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">Allocation</p>
          <div className="space-y-1.5">
            {budgetRows.map(({ label, tokens, color }) => {
              const pct = Math.max((tokens / budget.contextWindow) * 100, 0.5);
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-[140px] text-xs text-gray-600 truncate">{label}</div>
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="w-[80px] text-xs text-gray-500 text-right">{formatTokens(tokens)}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <div className="w-[140px] text-gray-600">Total Cap</div>
            <div>
              Normal: <span className="font-medium text-gray-700">~{formatTokens(budget.normalCap)}</span>
              {' '}&middot; With Excel: <span className="font-medium text-gray-700">~{formatTokens(budget.excelCap)}</span>
            </div>
          </div>
        </div>

        {/* Utilization warning */}
        {totalBudget > budget.contextWindow && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 mb-3">
            Warning: Total budget ({formatTokens(totalBudget)}) exceeds context window ({formatTokens(budget.contextWindow)}). The system will truncate context dynamically.
          </div>
        )}
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
