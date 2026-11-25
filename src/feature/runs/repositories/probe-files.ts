import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProbeExperiment, ProbeStore } from '../types/index.ts';

const ID = /^[a-z0-9]+$/;

/** Probes live beside the state directory: one JSON per experiment and the proposal of each. */
export class ProbeFiles implements ProbeStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  save(experiment: ProbeExperiment): void {
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(join(this.directory, `${experiment.id}.json`), JSON.stringify(experiment));
  }

  load(id: string): ProbeExperiment | null {
    if (!ID.test(id)) return null;
    return this.read(`${id}.json`, id);
  }

  list(): ProbeExperiment[] {
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith('.json') && ID.test(name.slice(0, -5)))
      .flatMap((name) => {
        const experiment = this.read(name, name.slice(0, -5));
        return experiment === null ? [] : [experiment];
      });
  }

  private read(file: string, id: string): ProbeExperiment | null {
    try {
      const text = readFileSync(join(this.directory, file), 'utf8');
      const parsed = JSON.parse(text) as ProbeExperiment;
      return parsed.id === id && Array.isArray(parsed.runs) ? parsed : null;
    } catch {
      return null;
    }
  }

  writeProposal(id: string, markdown: string): string {
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, `${id}.md`);
    writeFileSync(path, markdown);
    return path;
  }
}
