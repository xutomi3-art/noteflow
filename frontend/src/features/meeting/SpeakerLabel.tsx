import { useState, useRef, useEffect } from "react";

interface SpeakerLabelProps {
  speakerId: string;
  name: string;
  onRename: (speakerId: string, name: string) => void;
}

export function SpeakerLabel({ speakerId, name, onRename }: SpeakerLabelProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(name), [name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) {
      onRename(speakerId, trimmed);
    } else {
      setValue(name);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setValue(name); setEditing(false); }
        }}
        className="text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none px-0 py-0 w-32"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-semibold text-gray-800 hover:text-indigo-600 cursor-pointer transition-colors"
      title="Click to rename speaker"
    >
      {name}
    </button>
  );
}
