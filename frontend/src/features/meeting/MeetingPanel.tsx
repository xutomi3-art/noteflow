import { ArrowLeft, Mic } from "lucide-react";
import { useMeetingStore, ASR_PROVIDERS, ASR_LABELS } from "./meeting-store";
import { MeetingControls } from "./MeetingControls";
import { UtteranceList } from "./UtteranceList";
import { useSourceStore } from "../../stores/source-store";
import { useMemo } from "react";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const PROVIDER_COLORS: Record<string, string> = {
  qwen3: "bg-purple-500",
};

interface MeetingPanelProps {
  onClose: () => void;
}

export function MeetingPanel({ onClose }: MeetingPanelProps) {
  const {
    utterances,
    isRecording,
    isPaused,
    speakerMap,
    duration,
    error,
    pauseMeeting,
    resumeMeeting,
    endMeeting,
    renameSpeaker,
    reset,
  } = useMeetingStore();

  const fetchSources = useSourceStore((s) => s.fetchSources);
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);

  const groupedUtterances = useMemo(() => {
    const groups: Record<string, typeof utterances> = {};
    for (const p of ASR_PROVIDERS) {
      groups[p] = utterances.filter((u) => {
        const prov = u.provider || "";
        return prov === p || (!prov && p === ASR_PROVIDERS[0]);
      });
    }
    return groups;
  }, [utterances]);

  const handleEnd = async () => {
    const notebookId = activeMeeting?.notebook_id;
    const meetingId = activeMeeting?.id;
    // Stop audio + WebSocket immediately (synchronous cleanup)
    const store = useMeetingStore.getState();
    if (store._durationInterval) clearInterval(store._durationInterval);
    if (store._workletNode) store._workletNode.disconnect();
    if (store._mediaStream) store._mediaStream.getTracks().forEach(t => t.stop());
    if (store._audioContext) store._audioContext.close();
    if (store._ws?.readyState === WebSocket.OPEN) {
      store._ws.send(JSON.stringify({ type: "end" }));
      store._ws.close();
    }
    // Reset state + close panel immediately
    reset();
    onClose();
    // Call REST end API in background
    if (notebookId && meetingId) {
      const token = localStorage.getItem("access_token") || "";
      fetch(`/api/notebooks/${notebookId}/meetings/${meetingId}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).then(() => fetchSources(notebookId)).catch(() => {});
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Sources
        </button>
        <div className="flex items-center gap-1.5">
          {isRecording && !isPaused && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
          )}
          {isPaused && (
            <span className="text-[11px] text-amber-600 font-medium">PAUSED</span>
          )}
          {isRecording && (
            <span className="text-[11px] font-medium text-red-500">REC</span>
          )}
        </div>
      </div>

      {/* Timer + Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50/50 border-b border-slate-100">
        <span className="text-lg font-mono font-semibold text-slate-800">
          {formatDuration(duration)}
        </span>
        <MeetingControls
          isPaused={isPaused}
          onPause={pauseMeeting}
          onResume={resumeMeeting}
          onEnd={handleEnd}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-50 text-red-600 text-[11px]">
          {error}
        </div>
      )}

      {/* Transcript — 2-way comparison */}
      <div className="flex-1 overflow-y-auto">
        {ASR_PROVIDERS.map((provider) => (
          <div key={provider} className="border-b border-slate-100 last:border-b-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/80 border-b border-slate-100 sticky top-0 z-10">
              <span className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[provider] || "bg-gray-400"}`} />
              <span className="text-[11px] font-semibold text-slate-600">
                {ASR_LABELS[provider] || provider}
              </span>
              <span className="text-[10px] text-slate-400">
                {groupedUtterances[provider]?.filter((u) => u.is_final).length || 0} segments
              </span>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              <UtteranceList
                utterances={groupedUtterances[provider] || []}
                speakerMap={speakerMap}
                onRenameSpeaker={renameSpeaker}
                compact
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 text-center">
        <Mic className="w-3 h-3 inline mr-1" />
        Qwen3-ASR
      </div>
    </div>
  );
}
