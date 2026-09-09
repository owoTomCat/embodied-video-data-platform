import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

type FixtureOptions = {
  bootstrapExitCode?: number;
  keepApiRunning?: boolean;
};

function createStartupFixture(options: FixtureOptions = {}): {
  directory: string;
  logPath: string;
  scriptPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "evdp-start-local-"));
  const logPath = join(directory, "startup.log");
  const scriptPath = join(directory, "scripts", "start-local.mjs");

  mkdirSync(dirname(scriptPath), { recursive: true });
  mkdirSync(join(directory, "dist", "database"), { recursive: true });
  mkdirSync(join(directory, "dist", "cli"), { recursive: true });
  cpSync(join(BACKEND_ROOT, "scripts", "start-local.mjs"), scriptPath);

  const appendLogPrelude = `
    import { appendFileSync } from "node:fs";
    const append = (line) => appendFileSync(process.env.START_LOCAL_TEST_LOG, line + "\\n");
  `;

  writeFileSync(
    join(directory, "dist", "database", "data-source.js"),
    `${appendLogPrelude}
     export function createDataSource() {
       return {
         isInitialized: false,
         async initialize() { this.isInitialized = true; },
         async runMigrations() { append("migrate"); },
         async destroy() { this.isInitialized = false; },
       };
     }
    `,
  );
  writeFileSync(
    join(directory, "dist", "database", "run-migrations.js"),
    `${appendLogPrelude} append("migrate");`,
  );
  writeFileSync(
    join(directory, "dist", "cli", "bootstrap-local-identity.js"),
    `${appendLogPrelude}
     append("bootstrap:" + process.argv.slice(2).join(" "));
     ${options.bootstrapExitCode ? `process.exitCode = ${options.bootstrapExitCode};` : ""}
    `,
  );
  writeFileSync(
    join(directory, "dist", "cli", "seed-identity.js"),
    `${appendLogPrelude} append("legacy-seed");`,
  );
  writeFileSync(
    join(directory, "dist", "main.js"),
    options.keepApiRunning
      ? `${appendLogPrelude}
         append("api");
         process.once("SIGTERM", () => {
           append("api:SIGTERM");
           process.kill(process.pid, "SIGTERM");
         });
         setInterval(() => {}, 1_000);
        `
      : `${appendLogPrelude} append("api");`,
  );

  return { directory, logPath, scriptPath };
}

function fixtureEnvironment(logPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    START_LOCAL_TEST_LOG: logPath,
  };
}

function readLog(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

async function waitForLogLine(logPath: string, line: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (readLog(logPath).includes(line)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for log line: ${line}`);
}

describe("local backend startup script", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates, bootstraps an empty local identity store, then starts the API", () => {
    // This fails if local startup skips the production-local bootstrap,
    // invokes the legacy seed, reconciles/reset accounts, or changes ordering.
    const fixture = createStartupFixture();
    directories.push(fixture.directory);

    const result = spawnSync(process.execPath, [fixture.scriptPath], {
      env: fixtureEnvironment(fixture.logPath),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(readLog(fixture.logPath)).toEqual([
      "migrate",
      "bootstrap:",
      "api",
    ]);
  });

  it("does not start the API when the local identity bootstrap fails", () => {
    // This fails if startup ignores bootstrap failure or launches the API early.
    const fixture = createStartupFixture({ bootstrapExitCode: 23 });
    directories.push(fixture.directory);

    const result = spawnSync(process.execPath, [fixture.scriptPath], {
      env: fixtureEnvironment(fixture.logPath),
      encoding: "utf8",
    });

    expect(result.status).toBe(23);
    expect(readLog(fixture.logPath)).toEqual(["migrate", "bootstrap:"]);
  });

  it.skipIf(process.platform === "win32")(
    "forwards termination to the API and preserves signal termination",
    async () => {
      const fixture = createStartupFixture({ keepApiRunning: true });
      directories.push(fixture.directory);
      const localServer = spawn(process.execPath, [fixture.scriptPath], {
        env: fixtureEnvironment(fixture.logPath),
        stdio: "ignore",
      });

      try {
        await waitForLogLine(fixture.logPath, "api");
        localServer.kill("SIGTERM");
        const [exitCode, signal] = (await once(localServer, "exit")) as [
          number | null,
          NodeJS.Signals | null,
        ];

        expect(exitCode).toBeNull();
        expect(signal).toBe("SIGTERM");
        await waitForLogLine(fixture.logPath, "api:SIGTERM");
      } finally {
        if (localServer.exitCode === null && localServer.signalCode === null) {
          localServer.kill("SIGKILL");
          await once(localServer, "exit");
        }
      }
    },
  );
});
