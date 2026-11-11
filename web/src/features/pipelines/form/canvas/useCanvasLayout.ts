import { useCallback, useMemo, useState } from 'react';

import { forgetPreference, usePreference } from '../../../../shared/lib/browser/preferences.ts';
import type { CanvasNode } from '../steps/draftGraph.ts';
import {
  anchorsKey,
  withAnchor,
  withoutAnchor,
  type Anchors,
  type EdgeSides,
} from './canvasAnchors.ts';
import { layoutIdOf, resolveOverlap, snapPlace, type Layout } from './canvasLayout.ts';

const NONE: Layout = {};
const NO_ANCHORS: Anchors = {};

/** The key of the browser setting that holds the layout of one pipeline of one repository. */
export const layoutKey = (repository: string, pipelineId: string): string =>
  `canvasLayout.${repository}.${pipelineId}`;

/**
 * Where the person put the nodes: kept for the session by node id (a step keeps its place when
 * its specialist, and so its id, changes) and in the browser by layout id (a step is found again
 * after a reload).
 */
export function useCanvasLayout(repository: string, pipelineId: string, nodes: CanvasNode[]) {
  const key = layoutKey(repository, pipelineId);
  const [stored, setStored] = usePreference<Layout>(key, NONE);
  const sidesKey = anchorsKey(repository, pipelineId);
  const [storedSides, setStoredSides] = usePreference<Anchors>(sidesKey, NO_ANCHORS);
  // the key whose sides were given back to the defaults; the stored value of it is ignored
  const [unanchored, setUnanchored] = useState<string | null>(null);
  const anchors = unanchored === sidesKey ? NO_ANCHORS : storedSides;
  const [session, setSession] = useState<Layout>(NONE);
  // the key that was given back to the automatic layout; the stored value of it is ignored
  const [arranged, setArranged] = useState<string | null>(null);
  const remembered = arranged === key ? NONE : stored;
  const saved = useMemo(() => {
    const places: Layout = {};
    for (const node of nodes) {
      const place = session[node.id] ?? remembered[layoutIdOf(node)];
      if (place) places[node.id] = place;
    }
    return places;
  }, [nodes, session, remembered]);
  /** Remembers the places of all the nodes, the dropped one moved off the nodes it lies on. */
  const onDragStop = useCallback(
    (dropped: CanvasNode, shown: readonly CanvasNode[]) => {
      const place = resolveOverlap(
        { ...dropped, position: snapPlace(dropped, dropped.position) },
        shown,
      );
      const bySession: Layout = {};
      const byBrowser: Layout = {};
      for (const node of shown) {
        const at = node.id === dropped.id ? place : { ...node.position };
        bySession[node.id] = at;
        byBrowser[layoutIdOf(node)] = at;
      }
      setSession(bySession);
      setArranged(null);
      setStored(byBrowser);
    },
    [setStored],
  );
  /** Gives every node back to the automatic layout and forgets the remembered one. */
  const arrange = useCallback(() => {
    setSession(NONE);
    setArranged(key);
    forgetPreference(key);
    setUnanchored(sidesKey);
    forgetPreference(sidesKey);
  }, [key, sidesKey]);
  /** Remembers the sides the ends of a connection are moved to. */
  const setAnchor = useCallback(
    (edge: string, sides: EdgeSides) => {
      setUnanchored(null);
      setStoredSides(withAnchor(anchors, edge, sides));
    },
    [anchors, setStoredSides],
  );
  /** Gives the ends of a connection back to their default sides. */
  const resetAnchor = useCallback(
    (edge: string) => setStoredSides(withoutAnchor(anchors, edge)),
    [anchors, setStoredSides],
  );
  return { saved, onDragStop, arrange, anchors, setAnchor, resetAnchor };
}
