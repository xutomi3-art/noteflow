'use client';
import React, { useMemo } from 'react';
import ReactFlow, {
  Node, Edge, Background, Controls,
  useNodesState, useEdgesState, ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

interface MindMapNode {
  id: string;
  label: string;
  level: number;
  parent?: string;
}

interface MindMapData {
  nodes: MindMapNode[];
}

const LEVEL_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];

function buildGraph(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const byLevel: Record<number, number> = {};
  const nodes: Node[] = data.nodes.map((n) => {
    const x = n.level * 280;
    const y = (byLevel[n.level] ?? 0) * 100;
    byLevel[n.level] = (byLevel[n.level] ?? 0) + 1;
    return {
      id: n.id,
      position: { x, y },
      data: { label: n.label },
      style: {
        background: LEVEL_COLORS[n.level] ?? '#6b7280',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '6px 14px',
        fontSize: n.level === 0 ? '14px' : '12px',
        fontWeight: n.level === 0 ? 600 : 400,
        minWidth: '100px',
        textAlign: 'center' as const,
      },
    };
  });

  const edges: Edge[] = data.nodes
    .filter((n) => n.parent)
    .map((n) => ({
      id: `e-${n.parent}-${n.id}`,
      source: n.parent!,
      target: n.id,
      style: { stroke: '#94a3b8' },
    }));

  return { nodes, edges };
}

function MindMapInner({ data }: { data: MindMapData }) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraph(data),
    [data]
  );
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div style={{ height: '420px', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function MindMap({ rawJson }: { rawJson: string }) {
  const parsed = useMemo((): MindMapData | null => {
    try {
      const data = JSON.parse(rawJson) as MindMapData;
      if (!Array.isArray(data.nodes)) return null;
      return data;
    } catch {
      return null;
    }
  }, [rawJson]);

  if (!parsed) {
    return <div className="text-red-500 text-sm p-4">Failed to parse mind map data</div>;
  }

  return (
    <ReactFlowProvider>
      <MindMapInner data={parsed} />
    </ReactFlowProvider>
  );
}
