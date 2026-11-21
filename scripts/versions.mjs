#!/usr/bin/env node
// The files that carry the release version, besides package.json and package-lock.json (npm version
// writes those two).
//   node scripts/versions.mjs files          every file that carries the version, one per line
//   node scripts/versions.mjs set X.Y.Z      writes X.Y.Z into each field below
//   node scripts/versions.mjs check X.Y.Z    fails unless every field says X.Y.Z
// Only the value is replaced in the text, so the formatting of each file stays as prettier left it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** File (from the repository root) and the path of its version field. */
const FIELDS = [
  ['integrations/claude-code/.claude-plugin/plugin.json', ['version']],
  ['.claude-plugin/marketplace.json', ['metadata', 'version']],
];

const NPM_FILES = ['package.json', 'package-lock.json'];

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function get(value, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), value);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text with the field at path set to version: the one occurrence of the old value that does it. */
function replace(file, text, path, version) {
  const parsed = JSON.parse(text);
  const old = get(parsed, path);
  if (typeof old !== 'string') fail(`${file} has no string at ${path.join('.')}`);
  if (old === version) return text;
  const wanted = structuredClone(parsed);
  get(wanted, path.slice(0, -1))[path.at(-1)] = version;
  const key = JSON.stringify(path.at(-1));
  const pattern = new RegExp(`(${escape(key)}\\s*:\\s*)${escape(JSON.stringify(old))}`, 'g');
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    const next =
      text.slice(0, start) + JSON.stringify(version) + text.slice(match.index + match[0].length);
    if (isDeepStrictEqual(JSON.parse(next), wanted)) return next;
  }
  fail(`cannot find ${path.join('.')} in the text of ${file}`);
}

const [command, version] = process.argv.slice(2);
if (command === 'files') {
  for (const file of [...NPM_FILES, ...FIELDS.map(([file]) => file)]) console.log(file);
} else if (command === 'set' || command === 'check') {
  if (!version) fail(`usage: scripts/versions.mjs ${command} X.Y.Z`);
  for (const [file, path] of FIELDS) {
    const absolute = join(ROOT, file);
    const text = readFileSync(absolute, 'utf8');
    if (command === 'set') {
      const next = replace(file, text, path, version);
      if (next !== text) writeFileSync(absolute, next);
    } else {
      const found = get(JSON.parse(text), path);
      if (found !== version) fail(`${file} says ${found} at ${path.join('.')}, not ${version}`);
    }
  }
} else {
  console.error('usage: scripts/versions.mjs {files|set X.Y.Z|check X.Y.Z}');
  process.exit(2);
}
