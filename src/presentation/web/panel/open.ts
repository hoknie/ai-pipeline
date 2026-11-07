import { spawn } from 'node:child_process';

/** Opens the URL in the default browser; a failure only prints a hint. */
export function openBrowser(url: string, onError: (message: string) => void): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(opener, args, { stdio: 'ignore', detached: true })
    .on('error', () => {
      onError('aip web: could not open the browser; use the URL above\n');
    })
    .unref();
}
