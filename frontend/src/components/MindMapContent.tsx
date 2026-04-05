import MindMap from "./MindMap";
import MarkdownContent from "./MarkdownContent";

export default function MindMapContent({ content }: { content: string }) {
  let raw = content.trim();
  // Strip ```json fences
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(raw);
    return <MindMap data={parsed} />;
  } catch {
    return (
      <MarkdownContent
        content={content}
        className="text-[13px] text-slate-700 leading-relaxed"
      />
    );
  }
}
