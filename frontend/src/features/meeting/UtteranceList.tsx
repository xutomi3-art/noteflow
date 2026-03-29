import { useEffect, useRef } from "react";
import { SpeakerLabel } from "./SpeakerLabel";
import type { Utterance } from "./meeting-store";

interface UtteranceListProps {
  utterances: Utterance[];
  speakerMap: Record<string, string>;
  onRenameSpeaker: (speakerId: string, name: string) => void;
  compact?: boolean;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function UtteranceList({ utterances, speakerMap, onRenameSpeaker, compact }: UtteranceListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new utterances
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  if (utterances.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Waiting for speech...
      </div>
    );
  }

  // Group consecutive utterances by speaker
  const groups: { speakerId: string; items: Utterance[] }[] = [];
  for (const u of utterances) {
    const last = groups[groups.length - 1];
    if (last && last.speakerId === u.speaker_id) {
      last.items.push(u);
    } else {
      groups.push({ speakerId: u.speaker_id, items: [u] });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      {groups.map((group, i) => {
        const isPartialGroup = group.items.every((u) => !u.is_final);
        return (
        <div key={i} className="space-y-0.5">
          <div className="flex items-baseline gap-2">
            <SpeakerLabel
              speakerId={group.speakerId}
              name={speakerMap[group.speakerId] || group.speakerId}
              onRename={onRenameSpeaker}
            />
            <span className="text-xs text-gray-400">
              {formatTime(group.items[0].start_time_ms)}
            </span>
          </div>
          <div className="space-y-1">
            {group.items.map((u, j) => (
              <p key={j} className={`text-sm leading-relaxed ${u.is_final ? "text-gray-700" : "text-gray-400 italic"}`}>
                {u.text}
              </p>
            ))}
          </div>
        </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
