// Fake `aip web` for the tests of scripts/aip-web.sh.
// FAKE_WEB_DAEMON=1 prints the link of the daemon's panel and exits with 0,
// FAKE_WEB_FAIL=1 fails at once, FAKE_WEB_SILENT=1 never prints the link.
import { createServer } from 'node:http';

const index = process.argv.indexOf('--port');
const port = Number(process.argv[index + 1]);

if (process.env.FAKE_WEB_FAIL === '1') {
  process.stderr.write('aip: listen EADDRINUSE\n');
  process.exit(1);
}

if (process.env.FAKE_WEB_DAEMON === '1') {
  console.log(`aip web: http://127.0.0.1:${port}/?token=daemontoken1234567`);
  console.log('aip web: served by the aip daemon (pid 1)');
  process.exit(0);
}

const server = createServer((_request, response) => {
  response.writeHead(200);
  response.end('ok');
});
server.listen(port, '127.0.0.1', () => {
  if (process.env.FAKE_WEB_SILENT === '1') return;
  console.log(`aip web: http://127.0.0.1:${port}/?token=${process.env.AIP_WEB_TOKEN}`);
  console.log('Press Ctrl+C to stop.');
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
});
