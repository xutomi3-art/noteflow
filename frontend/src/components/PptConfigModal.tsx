import { useState, useEffect } from "react";
import { X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/services/api";

export interface PptConfig {
  template_id: string;
  scene: string;
  audience: string;
  language: string;
  length: "short" | "medium" | "long";
}

interface PptConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: PptConfig) => void;
  isGenerating: boolean;
}

interface Template {
  id: string;
  coverUrl: string;
  name?: string;
}

interface GenerationOptions {
  lang?: { label: string; value: string }[];
  scene?: { label: string; value: string }[];
  audience?: { label: string; value: string }[];
}

const LENGTH_OPTIONS: { value: PptConfig["length"]; label: string }[] = [
  { value: "short", label: "精简" },
  { value: "medium", label: "标准" },
  { value: "long", label: "详细" },
];

export default function PptConfigModal({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
}: PptConfigModalProps) {
  const [templateId, setTemplateId] = useState("");
  const [scene, setScene] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState("zh");
  const [length, setLength] = useState<PptConfig["length"]>("medium");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatePage, setTemplatePage] = useState(1);
  const [templateTotal, setTemplateTotal] = useState(0);
  const [templateLoading, setTemplateLoading] = useState(false);

  const [options, setOptions] = useState<GenerationOptions>({});
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  const pageSize = 8;

  // Load templates
  useEffect(() => {
    if (!isOpen) return;
    setTemplateLoading(true);
    api
      .listPptTemplates(templatePage, pageSize)
      .then((data) => {
        setTemplates(data.records || []);
        setTemplateTotal(data.total || 0);
        // Auto-select first template if none selected
        if (!templateId && data.records?.length > 0) {
          setTemplateId(data.records[0].id);
        }
      })
      .catch(() => setTemplates([]))
      .finally(() => setTemplateLoading(false));
  }, [isOpen, templatePage]);

  // Load generation options
  useEffect(() => {
    if (!isOpen || optionsLoaded) return;
    api
      .getPptGenerationOptions()
      .then((data) => {
        setOptions(data);
        setOptionsLoaded(true);
      })
      .catch(() => {});
  }, [isOpen, optionsLoaded]);

  if (!isOpen) return null;

  const totalPages = Math.ceil(templateTotal / pageSize);

  const handleGenerate = () => {
    onGenerate({
      template_id: templateId,
      scene,
      audience,
      language,
      length,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={isGenerating ? undefined : onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-slate-900">
            生成演示文稿
          </h2>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              选择模板
            </label>

            {templateLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-slate-400" />
                <span className="ml-2 text-sm text-slate-400">加载模板...</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3">
                  {templates.map((t) => {
                    const selected = templateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={isGenerating}
                        onClick={() => setTemplateId(t.id)}
                        className={`relative rounded-xl border-2 overflow-hidden transition-all disabled:opacity-60 aspect-[16/9] ${
                          selected
                            ? "border-[#5b8c15] ring-2 ring-[#5b8c15]/30"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <img
                          src={t.coverUrl}
                          alt={t.name || "Template"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {selected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#5b8c15] flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-3">
                    <button
                      type="button"
                      disabled={templatePage <= 1 || isGenerating}
                      onClick={() => setTemplatePage((p) => p - 1)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-xs text-slate-500">
                      {templatePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={templatePage >= totalPages || isGenerating}
                      onClick={() => setTemplatePage((p) => p + 1)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Scene selector */}
          {options.scene && options.scene.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                场景
              </label>
              <select
                value={scene}
                onChange={(e) => setScene(e.target.value)}
                disabled={isGenerating}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50 appearance-none"
              >
                <option value="">不限</option>
                {options.scene.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Audience selector */}
          {options.audience && options.audience.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                受众
              </label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                disabled={isGenerating}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50 appearance-none"
              >
                <option value="">不限</option>
                {options.audience.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Length segmented control */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              内容长度
            </label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {LENGTH_OPTIONS.map((opt) => {
                const active = length === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setLength(opt.value)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                      active
                        ? "bg-[#5b8c15] text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Language */}
          {options.lang && options.lang.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                语言
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isGenerating}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50 appearance-none"
              >
                {options.lang.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !templateId}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
            style={{ backgroundColor: "#5b8c15" }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                正在生成演示文稿...
              </>
            ) : (
              "生成演示文稿"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
