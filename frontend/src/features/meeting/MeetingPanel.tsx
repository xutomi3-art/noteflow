import { ArrowLeft, Mic } from "lucide-react";
import { useMeetingStore } from "./meeting-store";
import { MeetingControls } from "./MeetingControls";
import { UtteranceList } from "./UtteranceList";
import { useSourceStore } from "../../stores/source-store";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

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

  const handleEnd = async () => {
    const result = await endMeeting();
    if (result?.source_id && activeMeeting) {
      // Refresh sources to show the new meeting source
      await fetchSources(activeMeeting.notebook_id);
    }
    // Small delay then close
    setTimeout(() => {
      reset();
      onClose();
    }, 500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <button
          onClick={() => { reset(); onClose(); }}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Sources
        </button>
        <div className="flex items-center gap-1.5">
          {isRecording && !isPaused && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
          {isPaused && (
            <span className="text-xs text-yellow-600 font-medium">PAUSED</span>
          )}
          <span className="text-xs font-mono text-gray-500">
            {isRecording ? "REC" : ""}
          </span>
        </div>
      </div>

      {/* Timer + Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-lg font-mono font-medium text-gray-800">
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
        <div className="px-3 py-2 bg-red-50 text-red-600 text-xs">
          {error}
        </div>
      )}

      {/* Transcript */}
      <UtteranceList
        utterances={utterances}
        speakerMap={speakerMap}
        onRenameSpeaker={renameSpeaker}
      />

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-400 text-center">
        <Mic className="w-3 h-3 inline mr-1" />
        Click speaker names to rename
      </div>
    </div>
  );
}
