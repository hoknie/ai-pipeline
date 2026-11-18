import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STORE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'state');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'kv.json');
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
const write = (value) => fs.writeFileSync(file, JSON.stringify(value));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'argv.log'), JSON.stringify(args) + '\\n');
const input = fs.readFileSync(0, 'utf8');
if (input !== '') fs.appendFileSync(path.join(dir, 'stdin.log'), input);
if (fs.existsSync(path.join(__dirname, 'broken'))) {
  process.stderr.write('the keyring is locked');
  process.exit(2);
}
const kv = read();
const flag = (name) => args[args.indexOf(name) + 1];
const KIND = process.env.FAKE_KIND;
if (KIND === 'security') {
  if (args[0] === '-i') {
    for (const line of input.split('\\n')) {
      const match = /^add-generic-password -U -a "(.*)" -s "(.*)" -w "(.*)"$/.exec(line);
      if (match) kv[match[1]] = match[3];
    }
    write(kv);
  } else if (args[0] === 'find-generic-password') {
    const value = kv[flag('-a')];
    if (value === undefined) process.exit(44);
    process.stdout.write(value + '\\n');
  } else if (args[0] === 'delete-generic-password') {
    if (!(flag('-a') in kv)) process.exit(44);
    delete kv[flag('-a')];
    write(kv);
  }
} else if (args[0] === 'store') {
  kv[args[args.indexOf('account') + 1]] = input;
  write(kv);
} else if (args[0] === 'lookup') {
  const value = kv[args[args.indexOf('account') + 1]];
  if (value === undefined) process.exit(1);
  process.stdout.write(value);
} else if (args[0] === 'clear') {
  delete kv[args[args.indexOf('account') + 1]];
  write(kv);
}
`;

export interface FakeTool {
  /** Path of the executable. */
  file: string;
  /** Every argv the tool got, one per call. */
  argv(): string[][];
  /** Everything fed to its stdin. */
  stdin(): string;
  /** Makes it fail the way a locked keyring does. */
  break(): void;
}

/** A fake `security` or `secret-tool`: a real executable that keeps its values in a file. */
export function fakeTool(kind: 'security' | 'secret-tool'): FakeTool {
  const directory = mkdtempSync(join(tmpdir(), 'aip-fake-tool-'));
  const file = join(directory, kind);
  writeFileSync(
    file,
    `#!${process.execPath}\nprocess.env.FAKE_KIND = ${JSON.stringify(kind)};\n${STORE_SCRIPT}`,
  );
  chmodSync(file, 0o755);
  const state = (name: string): string => join(directory, 'state', name);
  const text = (name: string): string => {
    try {
      return readFileSync(state(name), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    file,
    argv: () =>
      text('argv.log')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
    stdin: () => text('stdin.log'),
    break: () => writeFileSync(join(directory, 'broken'), ''),
  };
}
