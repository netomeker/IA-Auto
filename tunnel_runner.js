const fs = require('fs');
const path = require('path');
const localtunnel = require('localtunnel');

const ROOT = process.cwd();
const URL_FILE = path.join(ROOT, 'public_url.txt');
const LOG_FILE = path.join(ROOT, 'public_tunnel.log');
const PID_FILE = path.join(ROOT, 'public_tunnel.pid');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function cleanupPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (_error) {
    // ignore
  }
}

async function start() {
  try {
    fs.writeFileSync(URL_FILE, '');
    fs.writeFileSync(PID_FILE, String(process.pid));
    log('Starting localtunnel on port 3000');

    const tunnel = await localtunnel({ port: 3000 });
    fs.writeFileSync(URL_FILE, String(tunnel.url || ''));
    log(`Tunnel URL: ${tunnel.url}`);

    tunnel.on('close', () => {
      log('Tunnel closed');
      cleanupPid();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      cleanupPid();
      tunnel.close();
    });
    process.on('SIGTERM', () => {
      cleanupPid();
      tunnel.close();
    });
  } catch (error) {
    cleanupPid();
    log(`Tunnel error: ${error.message || error}`);
    process.exit(1);
  }
}

start();
