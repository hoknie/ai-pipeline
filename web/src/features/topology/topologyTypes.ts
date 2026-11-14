import type { Node } from '@xyflow/react';

import type { StageSection } from '../../shared/lib/pipeline/pipelineStages.ts';
import type { LiveGroup } from './liveState.ts';

/** How busy the specialist of a node is on the whole machine. */
export interface Busy {
  /** Attempts of the specialist running now, in all runs. */
  running: number;
  /** Of them, those in runs this graph does not show. */
  elsewhere: number;
  /** The smallest limit; null when nothing limits the specialist. */
  max: number | null;
  full: boolean;
}

export interface StageData extends Record<string, unknown> {
  kind: 'split' | 'step' | 'merge' | 'delivery' | 'resolver' | 'action' | 'message' | 'cleanup';
  title: string;
  subtitle: string;
  /** The tooltip of the subtitle, when it is a name and the slug stands behind it. */
  subtitleHint?: string;
  detail: string | null;
  groups: LiveGroup[];
  attempts: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  active: boolean;
  /** Step id, for steps. */
  step: string | null;
  /** The variant shown skips the step. */
  skipped?: boolean;
  /** Slug of the specialist of the node; null for nodes without one. */
  specialist: string | null;
  busy: Busy | null;
  /** Id of the stage in the list of stages. */
  stageId: string;
  section: StageSection;
  /** The node opens its section of the graph. */
  sectionStart: boolean;
  /** Who performs the stage: a specialist, a command or the system. */
  performer: string;
  /** Label of the condition of the stage; null — the stage always runs. */
  condition: string | null;
  /** Address of the entry of the stage in the Pipeline tab. */
  link: string | null;
}

export type StageNode = Node<StageData, 'stage'>;

export interface Size {
  width: number;
  height: number;
}
