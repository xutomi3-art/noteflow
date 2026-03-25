import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";

interface MeetingControlsProps {
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

export function MeetingControls({ isPaused, onPause, onResume, onEnd }: MeetingControlsProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {/* Pause / Resume */}
      <button
        onClick={isPaused ? onResume : onPause}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title={isPaused ? "Resume" : "Pause"}
      >
        {isPaused ? (
          <Play className="w-5 h-5 text-green-600" />
        ) : (
          <Pause className="w-5 h-5 text-yellow-600" />
        )}
      </button>

      {/* End */}
      {confirmEnd ? (
        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-500">End?</span>
          <button
            onClick={() => { onEnd(); setConfirmEnd(false); }}
            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmEnd(false)}
            className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmEnd(true)}
          className="p-2 rounded-lg hover:bg-red-50 transition-colors"
          title="End meeting"
        >
          <Square className="w-5 h-5 text-red-500" />
        </button>
      )}
    </div>
  );
}
