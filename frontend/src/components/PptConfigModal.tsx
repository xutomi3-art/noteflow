import { useState } from "react";
import { X, Loader2 } from "lucide-react";

export interface PptConfig {
  n_slides: number;
  template: "general" | "modern" | "standard" | "swift";
  tone: string;
  verbosity: "concise" | "standard" | "text-heavy";
  language: string;
}

interface PptConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: PptConfig) => void;
  isGenerating: boolean;
}

const TEMPLATES: {
  key: PptConfig["template"];
  name: string;
  description: string;
  accent: string;
}[] = [
  {
    key: "general",
    name: "Classic",
    description: "Clean and versatile layout",
    accent: "#5b8c15",
  },
  {
    key: "modern",
    name: "Modern",
    description: "Bold headers, contemporary feel",
    accent: "#2563eb",
  },
  {
    key: "standard",
    name: "Standard",
    description: "Traditional business style",
    accent: "#6366f1",
  },
  {
    key: "swift",
    name: "Swift",
    description: "Minimal, fast-paced",
    accent: "#f59e0b",
  },
];

const TONES = [
  { value: "default", label: "Default" },
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "funny", label: "Funny" },
  { value: "educational", label: "Educational" },
  { value: "sales_pitch", label: "Sales Pitch" },
];

const VERBOSITY_OPTIONS: { value: PptConfig["verbosity"]; label: string }[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "text-heavy", label: "Text-heavy" },
];

export default function PptConfigModal({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
}: PptConfigModalProps) {
  const [template, setTemplate] = useState<PptConfig["template"]>("general");
  const [nSlides, setNSlides] = useState(8);
  const [tone, setTone] = useState("default");
  const [verbosity, setVerbosity] = useState<PptConfig["verbosity"]>("standard");
  const [language, setLanguage] = useState("中文");

  if (!isOpen) return null;

  const handleGenerate = () => {
    onGenerate({
      n_slides: nSlides,
      template,
      tone,
      verbosity,
      language,
    });
  };

  const handleSlideCount = (value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setNSlides(Math.max(3, Math.min(20, num)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={isGenerating ? undefined : onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Slide Deck Configuration
          </h2>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Template
            </label>
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map((t) => {
                const selected = template === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setTemplate(t.key)}
                    className={`relative text-left rounded-xl border-2 p-3 pt-0 overflow-hidden transition-all disabled:opacity-60 ${
                      selected
                        ? "border-[#5b8c15] bg-green-50/40"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    {/* Accent bar */}
                    <div
                      className="h-1.5 -mx-3 mb-3 rounded-b"
                      style={{ backgroundColor: t.accent }}
                    />
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {t.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {t.description}
                        </p>
                      </div>
                      {/* Radio indicator */}
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          selected
                            ? "border-[#5b8c15] bg-[#5b8c15]"
                            : "border-slate-300"
                        }`}
                      >
                        {selected && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slide count */}
          <div>
            <label
              htmlFor="ppt-slide-count"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Number of Slides
            </label>
            <input
              id="ppt-slide-count"
              type="number"
              min={3}
              max={20}
              value={nSlides}
              onChange={(e) => handleSlideCount(e.target.value)}
              disabled={isGenerating}
              className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50"
            />
            <span className="ml-2 text-xs text-slate-400">3 – 20</span>
          </div>

          {/* Tone selector */}
          <div>
            <label
              htmlFor="ppt-tone"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Tone
            </label>
            <select
              id="ppt-tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={isGenerating}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50 appearance-none"
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Verbosity segmented control */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Verbosity
            </label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {VERBOSITY_OPTIONS.map((opt) => {
                const active = verbosity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setVerbosity(opt.value)}
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
          <div>
            <label
              htmlFor="ppt-language"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Language
            </label>
            <input
              id="ppt-language"
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isGenerating}
              className="w-48 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15] disabled:opacity-60 disabled:bg-slate-50"
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
            style={{ backgroundColor: "#5b8c15" }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating presentation...
              </>
            ) : (
              "Generate Presentation"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
