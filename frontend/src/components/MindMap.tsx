import { useRef, useEffect, useState, useCallback } from "react";

/* ─── Types ─── */
interface TreeNode {
  label: string;
  children: TreeNode[];
}

interface LayoutNode {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
  depth: number;
}

/* ─── Constants ─── */
const NODE_H = 32;
const NODE_PAD_X = 16;
const NODE_PAD_Y = 8;
const H_GAP = 32; // horizontal gap between levels
const V_GAP = 8;  // vertical gap between siblings
const ROOT_COLOR = "#e11d48"; // rose-600
const DEPTH_COLORS = ["#7c3aed", "#4f46e5", "#0891b2", "#0d9488", "#059669", "#ca8a04"];

/* ─── Helpers: parse raw LLM data → TreeNode[] ─── */
function isFlatNodeList(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  const first = arr[0];
  return (
    !!first &&
    typeof first === "object" &&
    ("parent" in (first as object) || "level" in (first as object))
  );
}

function buildTreeFromFlat(
  nodes: Record<string, unknown>[]
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  const roots: Record<string, unknown>[] = [];
  for (const n of nodes) {
    map.set(String(n.id || ""), { ...n, children: [] as Record<string, unknown>[] });
  }
  for (const n of nodes) {
    const copy = map.get(String(n.id || ""))!;
    const parentId = n.parent as string | undefined;
    if (parentId && map.has(parentId)) {
      (map.get(parentId)!.children as Record<string, unknown>[]).push(copy);
    } else {
      roots.push(copy);
    }
  }
  return roots;
}

function toTreeNodes(data: unknown): TreeNode[] {
  if (!data) return [];

  // Array of flat nodes
  if (Array.isArray(data)) {
    const items = isFlatNodeList(data)
      ? buildTreeFromFlat(data as Record<string, unknown>[])
      : data;
    return items.map(convertObj).filter(Boolean) as TreeNode[];
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const label = (obj.label || obj.name || obj.topic || obj.title || obj.text || "") as string;
    const children = (obj.children || obj.nodes || obj.items || []) as unknown[];

    // Wrapper with no label — unwrap children
    if (!label && Array.isArray(children) && children.length > 0) {
      const items = isFlatNodeList(children as unknown[])
        ? buildTreeFromFlat(children as Record<string, unknown>[])
        : children;
      return items.map(convertObj).filter(Boolean) as TreeNode[];
    }

    if (label) {
      return [convertObj(obj)].filter(Boolean) as TreeNode[];
    }
  }

  return [];
}

function convertObj(raw: unknown): TreeNode | null {
  if (typeof raw === "string") return { label: raw, children: [] };
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = (obj.label || obj.name || obj.topic || obj.title || obj.text || "") as string;
  if (!label) return null;
  const rawChildren = (obj.children || obj.nodes || obj.items || []) as unknown[];
  const children = Array.isArray(rawChildren)
    ? rawChildren.map(convertObj).filter(Boolean) as TreeNode[]
    : [];
  return { label, children };
}

/* ─── Layout engine: compute x/y positions ─── */
function measureText(text: string, fontSize: number): number {
  // Approximate: avg char width ~0.55 * fontSize for sans-serif
  return text.length * fontSize * 0.55 + NODE_PAD_X * 2;
}

function layoutTree(roots: TreeNode[]): { nodes: LayoutNode[]; width: number; height: number } {
  if (roots.length === 0) return { nodes: [], width: 0, height: 0 };

  // If multiple roots, create a virtual root
  const singleRoot: TreeNode =
    roots.length === 1 ? roots[0] : { label: "", children: roots };

  let maxX = 0;
  let currentY = 0;

  function layout(node: TreeNode, depth: number, startX: number): LayoutNode {
    const fontSize = depth === 0 ? 14 : 12;
    const width = Math.max(measureText(node.label, fontSize), 60);
    const height = NODE_H;
    const x = startX;

    if (node.children.length === 0) {
      const y = currentY;
      currentY += height + V_GAP;
      maxX = Math.max(maxX, x + width);
      return { label: node.label, x, y, width, height, children: [], depth };
    }

    const childX = x + width + H_GAP;
    const childNodes = node.children.map((c) => layout(c, depth + 1, childX));

    // Center parent vertically among children
    const firstChild = childNodes[0];
    const lastChild = childNodes[childNodes.length - 1];
    const childTop = firstChild.y;
    const childBottom = lastChild.y + lastChild.height;
    const y = childTop + (childBottom - childTop) / 2 - height / 2;

    maxX = Math.max(maxX, x + width);

    return { label: node.label, x, y, width, height, children: childNodes, depth };
  }

  const root = layout(singleRoot, 0, 0);

  // If virtual root (no label), use children directly
  const resultNodes = root.label === "" ? root.children : [root];

  return {
    nodes: resultNodes,
    width: maxX + 20,
    height: currentY > 0 ? currentY - V_GAP + 20 : 100,
  };
}

/* ─── Render ─── */
function getNodeColor(depth: number): string {
  if (depth === 0) return ROOT_COLOR;
  return DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length];
}

function renderEdges(nodes: LayoutNode[]): React.ReactNode[] {
  const edges: React.ReactNode[] = [];

  function walk(node: LayoutNode) {
    for (const child of node.children) {
      const x1 = node.x + node.width;
      const y1 = node.y + node.height / 2;
      const x2 = child.x;
      const y2 = child.y + child.height / 2;
      const midX = (x1 + x2) / 2;

      edges.push(
        <path
          key={`${node.label}-${child.label}-${child.y}`}
          d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
          fill="none"
          stroke={getNodeColor(child.depth)}
          strokeWidth={1.5}
          strokeOpacity={0.4}
        />
      );
      walk(child);
    }
  }

  nodes.forEach(walk);
  return edges;
}

function renderNodes(nodes: LayoutNode[]): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  function walk(node: LayoutNode) {
    const color = getNodeColor(node.depth);
    const isRoot = node.depth === 0;
    const fontSize = isRoot ? 13 : 11;
    const fontWeight = isRoot ? 600 : 500;
    const bgOpacity = isRoot ? 1 : 0.08;
    const textColor = isRoot ? "#fff" : color;

    elements.push(
      <g key={`${node.label}-${node.x}-${node.y}`}>
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.height / 2}
          fill={isRoot ? color : color}
          fillOpacity={bgOpacity}
          stroke={color}
          strokeWidth={isRoot ? 0 : 1}
          strokeOpacity={0.3}
        />
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textColor}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        >
          {node.label}
        </text>
      </g>
    );

    node.children.forEach(walk);
  }

  nodes.forEach(walk);
  return elements;
}

/* ─── Main component ─── */
export default function MindMap({ data }: { data: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const roots = toTreeNodes(data);
  const { nodes, width, height } = layoutTree(roots);

  if (nodes.length === 0) {
    return <div className="text-[13px] text-slate-400 py-4 text-center">No mind map data</div>;
  }

  // Compute scale to fit horizontally
  const padding = 16;
  const svgWidth = width + padding * 2;
  const svgHeight = height + padding * 2;
  const scale = Math.min(1, (containerWidth - 8) / svgWidth);
  const displayHeight = svgHeight * scale;

  return (
    <div ref={containerRef} className="w-full overflow-x-auto overflow-y-auto" style={{ maxHeight: 400 }}>
      <svg
        width={svgWidth * scale}
        height={displayHeight}
        viewBox={`${-padding} ${-padding} ${svgWidth} ${svgHeight}`}
        className="select-none"
      >
        {renderEdges(nodes)}
        {renderNodes(nodes)}
      </svg>
    </div>
  );
}
