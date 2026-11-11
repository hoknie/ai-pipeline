// A stand-in for @xyflow/react in jsdom, which has no layout: it renders the nodes and the edges
// of the canvas with its own node and edge components, and keeps the props the canvas gave.
import type { ReactNode } from 'react';
import { vi } from 'vitest';

type Props = {
  nodes: {
    id: string;
    type: string;
    data: unknown;
    selected?: boolean;
    position: { x: number; y: number };
    measured?: { width?: number; height?: number };
    dragging?: boolean;
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    type?: string;
    data?: unknown;
    label?: unknown;
    selected?: boolean;
    selectable?: boolean;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }[];
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactNode>;
  edgeTypes: Record<string, (props: Record<string, unknown>) => ReactNode>;
  onNodesChange?: (changes: unknown[]) => void;
  onNodeClick?: (event: unknown, node: unknown) => void;
  onEdgeClick?: (event: unknown, edge: unknown) => void;
  onPaneClick?: () => void;
  onConnect?: (connection: { source: string; target: string }) => void;
  onReconnect?: (oldEdge: unknown, connection: unknown) => void;
  onNodeDragStop?: (event: unknown, node: unknown) => void;
  isValidConnection?: (connection: { source: string; target: string }) => boolean;
  children?: ReactNode;
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
            onClick={(event) => {
              // the plus of an edge sits in a portal of the real flow: its click is not a click on the edge
              if (!(event.target as Element).closest('button')) props.onEdgeClick?.(event, edge);
            }}
          >
            {Edge ? (
              <Edge
                id={edge.id}
                data={edge.data}
                label={edge.label}
                selected={Boolean(edge.selected)}
                selectable={edge.selectable !== false}
              />
            ) : (
              String(edge.label ?? '')
            )}
          </div>
        );
      })}
      {props.children}
      <button type="button" data-testid="fake-pane" onClick={() => props.onPaneClick?.()} />
    </div>
  );
}

const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** The calls of `fitView` of the stand-in for `useReactFlow`. */
export const fitView = vi.fn();

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
    Panel: passThrough,
    useReactFlow: () => ({ fitView }),
    BaseEdge: (props: Record<string, unknown>) => (
      <span
        data-testid={`edge-path-${String(props.id)}`}
        data-selected={props['data-selected'] as string}
      />
    ),
  };
}
