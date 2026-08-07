// pgContainer — boot a throwaway Postgres for an integration test file and hand
// back a superuser Pool. Ryuk is disabled under colima (see
// detect-container-runtime), so each test file MUST stop() its container in
// afterAll. The pool connects as the container superuser `postgres`, which
// BYPASSES RLS — that is deliberate: applyMigrations needs it (CREATE EXTENSION /
// CREATE ROLE), and the tenant/superuser executors layer role scoping on top.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';

export interface PgHarness {
  pool: Pool;
  stop(): Promise<void>;
}

// Match the image other integration suites use so we hit the warm local cache.
const POSTGRES_IMAGE = 'postgres:17-alpine';
const SUPERUSER = 'postgres';
const PASSWORD = 'testpass';
const DB_NAME = 'closet_test';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Under colima the mapped port can log "ready" a beat before the forwarded port
// actually accepts TCP, so a raw first connect hits ECONNREFUSED. Retry the
// initial SELECT 1 briefly rather than depend solely on the log-wait.
async function waitForAccepting(pool: Pool): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(250);
    }
  }
}

export async function startPg(): Promise<PgHarness> {
  const container: StartedTestContainer = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: SUPERUSER,
      POSTGRES_PASSWORD: PASSWORD,
      POSTGRES_DB: DB_NAME,
    })
    .withExposedPorts(5432)
    // Postgres logs the readiness line twice: once for the bootstrap instance,
    // once for the real one. Wait for the second so connections don't race init.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const pool = new Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: SUPERUSER,
    password: PASSWORD,
    database: DB_NAME,
  });

  await waitForAccepting(pool);

  // Teardown-only error sink. Stopping the container makes Postgres send 57P01
  // ("terminating connection due to administrator command") to any connection the
  // pool has not finished closing. pg re-emits that as a pool 'error' event with no
  // listener, so it surfaced as an UNHANDLED exception that failed the whole run
  // even though every assertion passed — observed intermittently (~1 run in 2)
  // under the parallel integration project, and it migrated between test files,
  // which is what proved it teardown-generic rather than any one suite's bug.
  //
  // The guard is deliberately narrow: it swallows errors ONLY after stop() has
  // begun. Before that, `stopping` is false and the error is re-thrown, so a real
  // mid-test connection failure still fails the test loudly.
  let stopping = false;
  pool.on('error', (error: Error) => {
    if (!stopping) throw error;
  });

  return {
    pool,
    async stop(): Promise<void> {
      stopping = true;
      await pool.end();
      await container.stop();
    },
  };
}
