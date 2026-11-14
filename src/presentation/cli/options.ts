import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import { DELIVERY_MODES, type DeliveryMode } from '../../feature/swarm-config/types/index.ts';
import { proposedGroupSchema } from '../ipc/contract/index.ts';

import { usage } from './io.ts';

export function readGroups(file: string) {
  return proposedGroupSchema
    .array()
    .min(1)
    .parse(parseYaml(readFileSync(file, 'utf8')));
}

/** Collects a repeatable option into a list. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export interface QueueTaskOptions {
  tag?: string[];
  parent?: string | false;
  after?: string[];
  skip?: string[];
  variant?: string;
  task?: string;
  groups?: string;
  title?: string;
  autoDeliver?: boolean;
  deliveryMode?: string;
  postpone?: boolean;
  repo: string;
  json?: boolean;
}

export function parseDeliveryMode(value: string | undefined): DeliveryMode | undefined {
  if (value === undefined) return undefined;
  const mode = DELIVERY_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw usage(`--delivery-mode must be one of: ${DELIVERY_MODES.join(', ')}`);
  }
  return mode;
}

export function parseSwitch(flag: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw usage(`${flag} must be on or off`);
}
