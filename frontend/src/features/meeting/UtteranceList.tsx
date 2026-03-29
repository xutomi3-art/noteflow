import { useEffect, useRef } from "react";
import type { Utterance } from "./meeting-store";

interface UtteranceListProps {
  utterances: Utterance[];
  speakerMap: Record<string, string>;
  onRenameSpeaker: (speakerId: string, name: string) => void;
  compact?: boolean;
}

export function UtteranceList({ utterances, speakerMap, onRenameSpeaker, compact }: UtteranceListProps) {
  const endRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
      {utterances.map((u, i) => (
        <p key={i} className={`text-sm leading-relaxed ${u.is_final ? "text-gray-700" : "text-gray-400 italic"}`}>
          {u.wall_time && (
            <span className="text-[10px] text-gray-300 mr-1.5 font-mono">{u.wall_time}</span>
          )}
          {u.text}
        </p>
      ))}
      <div ref={endRef} />
    </div>
  );
}
