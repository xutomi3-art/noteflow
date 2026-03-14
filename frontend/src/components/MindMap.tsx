import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";

/* ─── Colors ─── */
const ROOT_COLOR = "#e11d48";
const DEPTH_COLORS = [
  "#7c3aed",
  "#4f46e5",
  "#0891b2",
  "#0d9488",
  "#059669",
  "#ca8a04",
];

function getNodeColor(depth: number): string {
  if (depth === 0) return ROOT_COLOR;
  return DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length];
}

/* ─── Custom Node ─── */
function MindMapNode({ data }: { data: { label: string; depth: number } }) {
  const color = getNodeColor(data.depth);
  const isRoot = data.depth === 0;

  return (
    <div
      style={{
        background: isRoot ? color : `${color}14`,
        border: isRoot ? "none" : `1.5px solid ${color}50`,
        color: isRoot ? "#fff" : color,
        borderRadius: 999,
        padding: "6px 16px",
        fontSize: isRoot ? 13 : 11,
        fontWeight: isRoot ? 600 : 500,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        whiteSpace: "nowrap",
        cursor: "grab",
        boxShadow: isRoot
          ? `0 2px 8px ${color}40`
          : `0 1px 3px ${color}15`,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      {data.label}
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { mindmap: MindMapNode };

/* ─── Parse LLM data ─── */
interface FlatNode {
  id: string;
  label: string;
  level: number;
  parent?: string;
}

function parseFlatNodes(data: unknown): FlatNode[] {
  if (!data) return [];

  let raw: unknown[] = [];

  if (Array.isArray(data)) {
    raw = data;
  } else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const arr = obj.nodes || obj.children || obj.items;
    if (Array.isArray(arr)) raw = arr;
    else {
      // Single root with label
      const label = (obj.label || obj.name || obj.topic || obj.title || "") as string;
      if (label) return [{ id: "root", label, level: 0 }];
      return [];
    }
  }

  return raw
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n, i) => ({
      id: String(n.id || `n${i}`),
      label: String(n.label || n.name || n.topic || n.title || n.text || ""),
      level: typeof n.level === "number" ? n.level : 0,
      parent: n.parent ? String(n.parent) : undefined,
    }))
    .filter((n) => n.label);
}

/* ─── Dagre layout ─── */
function buildGraph(flatNodes: FlatNode[]): { nodes: Node[]; edges: Edge[] } {
  if (flatNodes.length === 0) return { nodes: [], edges: [] };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 12,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Estimate node widths
  for (const n of flatNodes) {
    const isRoot = n.level === 0;
    const charWidth = isRoot ? 8 : 7;
    const width = Math.max(n.label.length * charWidth + 32, 60);
    const height = isRoot ? 36 : 30;
    g.setNode(n.id, { width, height });
  }

  const edges: Edge[] = [];
  for (const n of flatNodes) {
    if (n.parent) {
      const edgeId = `${n.parent}-${n.id}`;
      g.setEdge(n.parent, n.id);
      edges.push({
        id: edgeId,
        source: n.parent,
        target: n.id,
        type: "smoothstep",
        style: {
          stroke: getNodeColor(n.level),
          strokeWidth: 1.5,
          opacity: 0.5,
        },
        animated: false,
      });
    }
  }

  dagre.layout(g);

  const nodes: Node[] = flatNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "mindmap",
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: { label: n.label, depth: n.level },
    };
  });

  return { nodes, edges };
}

/* ─── Flow component ─── */
function MindMapFlow({ data }: { data: unknown }) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraph(parseFlatNodes(data)),
    [data],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges] = useEdgesState(initialEdges);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    setTimeout(() => instance.fitView(), 50);
  }, []);

  if (initialNodes.length === 0) {
    return (
      <div className="text-[13px] text-slate-400 py-4 text-center">
        No mind map data
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 380 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        panOnScroll={false}
        style={{ background: "transparent" }}
      />
    </div>
  );
}

/* ─── Wrapper with provider ─── */
export default function MindMap({ data }: { data: unknown }) {
  return (
    <ReactFlowProvider>
      <MindMapFlow data={data} />
    </ReactFlowProvider>
  );
}
