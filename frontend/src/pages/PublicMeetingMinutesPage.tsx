import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardList, Loader2, AlertCircle } from "lucide-react";
import MarkdownContent from "@/components/MarkdownContent";

interface MinutesData {
  title: string;
  content: string;
  notebook_name: string;
  created_by: string;
  created_at: string;
  view_count: number;
}

export default function PublicMeetingMinutesPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<MinutesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/meeting-minutes/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to load meeting minutes");
        }
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800 mb-1">Unable to load</h1>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const dateStr = new Date(data.created_at).toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{data.title}</h1>
            <p className="text-xs text-slate-500">
              {data.created_by} &middot; {dateStr}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <img src="/logo.png" alt="Noteflow" className="w-6 h-6 rounded-md" />
            <span className="text-sm font-semibold text-slate-600 hidden sm:inline">Noteflow</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="prose prose-sm max-w-none text-[14px] text-slate-700 leading-relaxed">
            <MarkdownContent content={data.content} />
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">
          Shared via <a href="/" className="text-[#5b8c15] hover:underline">Noteflow</a>
        </p>
      </main>
    </div>
  );
}
