import { useEffect, useState, useMemo, useCallback } from 'react';
import { Save, TestTube, Loader2, Database, ChevronDown, ChevronRight } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';
import { api } from '@/services/api';

/* ------------------------------------------------------------------ */
/* Field / group types                                                */
/* ------------------------------------------------------------------ */
interface Field {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  toggle?: boolean;
}

interface ModelTier {
  tier: 'primary' | 'secondary';
  label: string;
  fields: Field[];
}

interface ModelGroup {
  title: string;
  description: string;
  tiers: ModelTier[];
}

/* ------------------------------------------------------------------ */
/* Model groups — organized by model TYPE, each with primary/secondary */
/* ------------------------------------------------------------------ */
const MODEL_GROUPS: ModelGroup[] = [
  {
    title: 'Chat LLM',
    description: 'Main text generation model — used for Q&A, Studio, Overview, and all AI features',
    tiers: [
      {
        tier: 'primary',
        label: 'Primary',
        fields: [
          { key: 'llm_base_url', label: 'Base URL', placeholder: 'e.g. https://dashscope.aliyuncs.com/compatible-mode/v1' },
          { key: 'llm_model', label: 'Model', placeholder: 'e.g. qwen3.5-plus, gpt-4o, deepseek-chat' },
          { key: 'qwen_api_key', label: 'API Key', secret: true },
          { key: 'llm_context_window', label: 'Context Window', placeholder: 'e.g. 32768' },
          { key: 'llm_max_output_tokens', label: 'Max Output Tokens', placeholder: 'e.g. 16384' },
        ],
      },
      {
        tier: 'secondary',
        label: 'Secondary (Backup)',
        fields: [
          { key: 'llm_backup_enabled', label: 'Enable Fallback', toggle: true, placeholder: 'Auto-switch to secondary when primary is unreachable' },
          { key: 'llm_backup_base_url', label: 'Base URL', placeholder: 'e.g. https://dashscope.aliyuncs.com/compatible-mode/v1' },
          { key: 'llm_backup_model', label: 'Model', placeholder: 'e.g. qwen3.5-plus' },
          { key: 'llm_backup_api_key', label: 'API Key', secret: true },
          { key: 'llm_backup_context_window', label: 'Context Window', placeholder: 'e.g. 1000000' },
        ],
      },
    ],
  },
  {
    title: 'Vision LLM',
    description: 'Extracts text from charts, diagrams, and images in PDFs during document processing',
    tiers: [
      {
        tier: 'primary',
        label: 'Primary',
        fields: [
          { key: 'vision_enabled', label: 'Vision Analysis', toggle: true, placeholder: 'Analyze chart/diagram images in PDFs' },
          { key: 'llm_vision_model', label: 'Model', placeholder: 'default: glm-4.5v' },
          { key: 'llm_vision_base_url', label: 'Base URL', placeholder: 'default: https://open.bigmodel.cn/api/paas/v4' },
          { key: 'llm_vision_api_key', label: 'API Key', secret: true },
        ],
      },
      {
        tier: 'secondary',
        label: 'Secondary (Backup)',
        fields: [],
      },
    ],
  },
];

/* Standalone settings groups (no primary/secondary) */
interface FieldGroup {
  title: string;
  description: string;
  fields: Field[];
}

const EXTRA_GROUPS: FieldGroup[] = [
  {
    title: 'RAG Retrieval',
    description: 'RAGFlow connection and retrieval tuning parameters',
    fields: [
      { key: 'ragflow_api_key', label: 'API Key', secret: true },
      { key: 'ragflow_base_url', label: 'Base URL' },
      { key: 'rag_top_k', label: 'Top-K Chunks', placeholder: 'default: 8' },
      { key: 'rag_similarity_threshold', label: 'Similarity Threshold', placeholder: 'default: 0.0 (0.0–1.0, lower = more results)' },
      { key: 'rag_vector_weight', label: 'Vector Weight', placeholder: 'default: 0.7 (0.0–1.0, higher = more semantic)' },
      { key: 'rag_rerank_id', label: 'Rerank Model', placeholder: 'default: gte-rerank' },
      { key: 'raptor_enabled', label: 'Raptor Clustering', toggle: true, placeholder: 'Cross-document hierarchical summarization (uses LLM tokens, slower indexing)' },
    ],
  },
  {
    title: 'Query Processing',
    description: 'Query rewrite and deep thinking — uses the main Chat LLM',
    fields: [
      { key: 'query_rewrite_enabled', label: 'Query Rewrite', toggle: true, placeholder: 'Rewrite user questions into keywords for better retrieval (uses LLM, adds latency)' },
      { key: 'rag_decompose_model', label: 'Deep Think Model', placeholder: 'empty = use main model (for CoT query decomposition)' },
      { key: 'rag_think_rounds', label: 'Deep Think Rounds', placeholder: 'default: 5 (max ReAct search rounds)' },
    ],
  },
];

const ALL_KEYS = [
  ...MODEL_GROUPS.flatMap((g) => g.tiers.flatMap((t) => t.fields.map((f) => f.key))),
  ...EXTRA_GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
];

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */
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

  // RAGFlow model providers (embedding/rerank connection details)
  interface Provider { llm_factory: string; model_type: string; llm_name: string; api_base: string; api_key?: string; status: string }
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerForms, setProviderForms] = useState<Record<string, { api_base: string; api_key: string }>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);

  const fetchRagflowModels = useCallback(async () => {
    setRagflowLoading(true);
    setRagflowError('');
    try {
      const [models, provs] = await Promise.all([
        api.getRagflowModels(),
        api.getRagflowProviders(),
      ]);
      setRagflowModels(models);
      setRagflowForm(models);
      setProviders(provs);
      const pForms: Record<string, { api_base: string; api_key: string }> = {};
      for (const p of provs) {
        pForms[`${p.llm_factory}/${p.llm_name}`] = { api_base: p.api_base || '', api_key: '' };
      }
      setProviderForms(pForms);
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

  const budget = useMemo(() => {
    const contextWindow = parseInt(form.llm_context_window || '0') || 128000;
    const maxOutput = parseInt(form.llm_max_output_tokens || '0') || 8192;
    const topK = parseInt(form.rag_top_k || '0') || 15;
    const systemPrompt = 1000;
    const historyBudget = Math.min(Math.round(contextWindow * 0.06), 60000);
    const ragBudget = topK * 1500;
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

  /* ---- Shared field renderer ---- */
  const renderField = (f: Field) => (
    <div key={f.key}>
      {f.toggle ? (
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-700">{f.label}</label>
            {f.placeholder && <p className="text-[11px] text-gray-400 mt-0.5">{f.placeholder}</p>}
          </div>
          <button
            onClick={() => setForm({ ...form, [f.key]: (form[f.key] ?? 'false').toLowerCase() === 'true' ? 'false' : 'true' })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              (form[f.key] ?? 'false').toLowerCase() === 'true' ? 'bg-[#5b8c15]' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              (form[f.key] ?? 'false').toLowerCase() === 'true' ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700">{f.label}</label>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              getSource(f.key) === 'db' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {getSource(f.key) === 'db' ? 'DB override' : 'env default'}
            </span>
          </div>
          <input
            type={f.secret ? 'password' : 'text'}
            value={form[f.key] ?? ''}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            placeholder={f.placeholder || f.label}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
          />
        </>
      )}
    </div>
  );

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

      {/* ========== Model groups (Primary / Secondary) ========== */}
      {MODEL_GROUPS.map((group) => (
        <div key={group.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-0.5">{group.title}</h3>
          <p className="text-xs text-gray-400 mb-5">{group.description}</p>

          <div className="space-y-5">
            {group.tiers.map((tier) => (
              <div key={tier.tier}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    tier.tier === 'primary'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {tier.tier === 'primary' ? 'Primary' : 'Secondary'}
                  </span>
                  <span className="text-xs text-gray-500">{tier.label}</span>
                </div>

                {tier.fields.length > 0 ? (
                  <div className="space-y-3 pl-3 border-l-2 border-gray-100">
                    {tier.fields.map(renderField)}
                  </div>
                ) : (
                  <div className="pl-3 border-l-2 border-gray-100">
                    <p className="text-xs text-gray-400 italic py-2">Not configured — leave empty for now</p>
                  </div>
                )}

                {tier.tier === 'primary' && <div className="border-b border-gray-100 mt-5" />}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ========== Embedding & Rerank (RAGFlow Internal) ========== */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-0.5">
          <Database size={16} className="text-gray-500" />
          <h3 className="text-base font-semibold text-gray-900">Embedding & Rerank</h3>
        </div>
        <p className="text-xs text-gray-400 mb-5">
          Models used by RAGFlow for chunking, embedding, and reranking. Stored in RAGFlow&apos;s database.
        </p>
        {ragflowError && <p className="text-sm text-red-600 mb-3">{ragflowError}</p>}
        {ragflowLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Primary tier */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Primary
                </span>
                <span className="text-xs text-gray-500">Active models in RAGFlow</span>
              </div>
              <div className="space-y-4 pl-3 border-l-2 border-gray-100">
                {[
                  { key: 'llm_id', label: 'Chunk Processing LLM', placeholder: 'e.g. qwen-plus (for auto_keywords/questions & RAPTOR)' },
                  { key: 'embd_id', label: 'Embedding Model', placeholder: 'e.g. BAAI/bge-m3' },
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
              <div className="mt-4 pl-3 flex items-center gap-3">
                <button
                  onClick={handleSaveRagflow}
                  disabled={ragflowSaving}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors disabled:opacity-50"
                >
                  {ragflowSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save RAGFlow Models
                </button>
                {ragflowMessage && <span className="text-sm text-green-600">{ragflowMessage}</span>}
              </div>
            </div>

            <div className="border-b border-gray-100 mb-5" />

            {/* Secondary tier — placeholder */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Secondary
                </span>
                <span className="text-xs text-gray-500">Backup (not yet supported by RAGFlow)</span>
              </div>
              <div className="pl-3 border-l-2 border-gray-100">
                <p className="text-xs text-gray-400 italic py-2">Not configured — RAGFlow does not support embedding fallback yet</p>
              </div>
            </div>

            {/* Model Provider Connections */}
            {providers.length > 0 && (
              <div className="pt-5 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Provider Connections</h4>
                <div className="space-y-4">
                  {providers.map((p) => {
                    const pk = `${p.llm_factory}/${p.llm_name}`;
                    const pf = providerForms[pk] || { api_base: '', api_key: '' };
                    const baseChanged = pf.api_base !== (p.api_base || '');
                    const keyChanged = pf.api_key !== '';
                    const hasChanges = baseChanged || keyChanged;
                    return (
                      <div key={pk} className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-medium text-gray-700">{p.llm_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{p.llm_factory}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{p.model_type}</span>
                          </div>
                          <input
                            type="text"
                            value={pf.api_base}
                            onChange={(e) => setProviderForms({ ...providerForms, [pk]: { ...pf, api_base: e.target.value } })}
                            placeholder="API Base URL (e.g. http://10.200.0.102:9997)"
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] mb-1.5"
                          />
                          <input
                            type="password"
                            value={pf.api_key}
                            onChange={(e) => setProviderForms({ ...providerForms, [pk]: { ...pf, api_key: e.target.value } })}
                            placeholder="API Key (leave empty to keep current)"
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            if (!hasChanges) return;
                            setProviderSaving(pk);
                            try {
                              const update: Record<string, string> = { llm_factory: p.llm_factory, llm_name: p.llm_name };
                              if (baseChanged) update.api_base = pf.api_base;
                              if (keyChanged) update.api_key = pf.api_key;
                              const updated = await api.updateRagflowProvider(update);
                              setProviders(updated);
                              setProviderForms({ ...providerForms, [pk]: { ...pf, api_key: '' } });
                              setRagflowMessage('Provider updated');
                              setTimeout(() => setRagflowMessage(''), 3000);
                            } catch (e) {
                              setRagflowError(e instanceof Error ? e.message : 'Failed to update provider');
                            } finally {
                              setProviderSaving(null);
                            }
                          }}
                          disabled={providerSaving === pk || !hasChanges}
                          className="mt-6 px-2 py-1.5 text-xs font-medium text-[#5b8c15] border border-[#5b8c15]/30 rounded-lg hover:bg-[#5b8c15]/5 transition-colors disabled:opacity-30 disabled:cursor-default whitespace-nowrap"
                        >
                          {providerSaving === pk ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ========== Extra groups (flat, no primary/secondary) ========== */}
      {EXTRA_GROUPS.map((group) => (
        <div key={group.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-0.5">{group.title}</h3>
          <p className="text-xs text-gray-400 mb-4">{group.description}</p>
          <div className="space-y-4">
            {group.fields.map(renderField)}
          </div>
        </div>
      ))}

      {/* ========== Token Budget ========== */}
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
        {totalBudget > budget.contextWindow && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 mb-3">
            Warning: Total budget ({formatTokens(totalBudget)}) exceeds context window ({formatTokens(budget.contextWindow)}). The system will truncate context dynamically.
          </div>
        )}
      </div>

      {/* ========== Actions ========== */}
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
      {saveMessage && <p className="text-sm text-green-600">{saveMessage}</p>}
      {testResult && (
        <p className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
          {testResult.message}
        </p>
      )}
    </div>
  );
}
