// A stand-in for @xyflow/react in jsdom, which has no layout: it renders the nodes and the edges
// of the canvas with its own node and edge components, and keeps the props the canvas gave.
import type { ReactNode } from 'react';
import { vi } from 'vitest';

type Props = {
  nodes: { id: string; type: string; data: unknown; selected?: boolean; position: { x: number } }[];
  edges: { id: string; type?: string; data?: unknown; label?: unknown }[];
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactNode>;
  edgeTypes: Record<string, (props: Record<string, unknown>) => ReactNode>;
  onNodeClick?: (event: unknown, node: unknown) => void;
  onEdgeClick?: (event: unknown, edge: unknown) => void;
  onPaneClick?: () => void;
  onConnect?: (connection: { source: string; target: string }) => void;
  onNodeDragStop?: (event: unknown, node: unknown) => void;
  isValidConnection?: (connection: { source: string; target: string }) => boolean;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  deleteKeyCode?: unknown;
};

/** The props of the last render of the flow. */
export const flow: { props: Props | null } = { props: null };

function FakeFlow(props: Props) {
  flow.props = props;
  return (
    <div data-testid="fake-flow">
      {props.nodes.map((node) => {
        const Node = props.nodeTypes[node.type]!;
        return (
          <div key={node.id} onClick={(event) => props.onNodeClick?.(event, node)}>
            <Node id={node.id} data={node.data} selected={Boolean(node.selected)} />
          </div>
        );
      })}
      {props.edges.map((edge) => {
        const Edge = edge.type ? props.edgeTypes[edge.type] : undefined;
        return (
          <div
            key={edge.id}
            data-testid={`edge-${edge.id}`}
            onClick={(event) => props.onEdgeClick?.(event, edge)}
          >
            {Edge ? <Edge id={edge.id} data={edge.data} /> : String(edge.label ?? '')}
          </div>
        );
      })}
      <button type="button" data-testid="fake-pane" onClick={() => props.onPaneClick?.()} />
    </div>
  );
}

const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** The factory for `vi.mock('@xyflow/react', …)`. */
export async function fakeFlow() {
  const actual = await vi.importActual<Record<string, unknown>>('@xyflow/react');
  return {
    ...actual,
    ReactFlow: FakeFlow,
    ReactFlowProvider: passThrough,
    EdgeLabelRenderer: passThrough,
    Handle: () => null,
    Background: () => null,
    Controls: () => null,
    BaseEdge: () => null,
    getBezierPath: () => ['', 0, 0],
  };
}
