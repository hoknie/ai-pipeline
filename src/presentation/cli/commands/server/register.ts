import type { Command } from 'commander';

import type { Style } from '../../../format/index.ts';
import type { CliIo } from '../../io.ts';
import { registerAdmin } from './admin.ts';
import { registerAudit } from './audit.ts';
import { registerLogin } from './login.ts';

/** `aip login`, `logout`, `whoami`, `token` and `server`: work with an aip server. */
export function registerServer(program: Command, io: CliIo, style: Style): void {
  registerLogin(program, io, style);
  registerAdmin(program, io, style);
  registerAudit(program, io, style);
}
