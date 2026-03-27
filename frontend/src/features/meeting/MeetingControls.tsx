import { useState } from "react";

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
        className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors bg-[#f0f5e0] text-[#5b8c15] hover:bg-[#e4edcf]"
      >
        {isPaused ? "Resume" : "Pause"}
      </button>

      {/* End */}
      {confirmEnd ? (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">End meeting?</span>
          <button
            onClick={() => { onEnd(); setConfirmEnd(false); }}
            className="px-2 py-1 rounded text-[11px] font-medium bg-red-500 text-white hover:bg-red-600"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmEnd(false)}
            className="px-2 py-1 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmEnd(true)}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors bg-red-50 text-red-600 hover:bg-red-100"
        >
          End
        </button>
      )}
    </div>
  );
}
