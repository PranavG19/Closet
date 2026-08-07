// detect-container-runtime — auto-detect Docker Desktop vs colima and set env
// vars so testcontainers finds the right daemon and host address. Ported from
// fitapp (the machine runs colima). Used as the integration project's setupFile.
//
// Colima incompatibilities resolved here:
//   1. DOCKER_HOST → colima's socket (not Docker Desktop's).
//   2. TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 (colima forwards IPv4 only;
//      testcontainers' default `localhost` resolves IPv6 first → ECONNREFUSED).
//   3. TESTCONTAINERS_RYUK_DISABLED=true (Ryuk's log-wait fails under colima's VM;
//      tests do explicit container.stop() in afterAll instead).
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const COLIMA_SOCKET = `${process.env.HOME}/.colima/default/docker.sock`;

export function configureContainerRuntime(): void {
  if (process.env.DOCKER_HOST) return;

  if (existsSync(COLIMA_SOCKET)) {
    process.env.DOCKER_HOST = `unix://${COLIMA_SOCKET}`;
    process.env.TESTCONTAINERS_HOST_OVERRIDE = '127.0.0.1';
    process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
    return;
  }

  const desktopSocket = `${process.env.HOME}/.docker/run/docker.sock`;
  if (existsSync(desktopSocket)) {
    try {
      execSync('docker ps --format "{{.ID}}"', {
        stdio: 'ignore',
        timeout: 5000,
        env: { ...process.env, DOCKER_HOST: `unix://${desktopSocket}` },
      });
      process.env.DOCKER_HOST = `unix://${desktopSocket}`;
    } catch {
      // Desktop unreachable / 407-locked — no fallback.
    }
  }
}

configureContainerRuntime();
