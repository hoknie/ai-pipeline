import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configFromFiles } from '../src/feature/swarm-config/services/index.ts';
import { findPipeline } from '../src/feature/swarm-config/types/index.ts';

const root = join(import.meta.dirname, '..');

function json(file: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}

function template(file: string): string {
  return readFileSync(join(root, 'templates', 'aip', file), 'utf8');
}

describe('npm package', () => {
  const manifest = json('package.json');

  it('is public, has the aip command and builds on pack', () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.name).toBe('@hoknie/aip');
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.bin).toEqual({ aip: 'dist/cli/main.js' });
    expect(manifest.scripts.prepack).toBe('npm run build');
  });

  it('ships the build, the template, the marketplace and the mod without its tests', () => {
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        'dist',
        'templates',
        '.claude-plugin',
        'integrations/claude-code',
        '!integrations/claude-code/test',
      ]),
    );
    for (const path of manifest.files as string[]) {
      if (path === 'dist' || path.startsWith('!')) continue;
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });

  it('has a marketplace whose plugin is the mod, with the version of the package', () => {
    const marketplace = json('.claude-plugin/marketplace.json');
    expect(marketplace.name).toBe('aip');
    const plugin = marketplace.plugins.find((entry: { name: string }) => entry.name === 'aip');
    expect(plugin).toBeDefined();
    const mod = json(join(plugin.source, '.claude-plugin', 'plugin.json'));
    expect(mod.name).toBe('aip');
    expect(mod.version).toBe(manifest.version);
  });

  it('the starter template is a valid configuration with a two step feature pipeline', () => {
    const config = configFromFiles({
      settings: template('settings.yaml'),
      specialists: {
        coder: template('specialists/coder.yaml'),
        reviewer: template('specialists/reviewer.yaml'),
      },
      pipelines: { feature: template('pipelines/feature.yaml') },
    });
    expect(findPipeline(config, 'feature')?.steps.map((step) => step.id)).toEqual([
      'code',
      'review',
    ]);
  });
});
