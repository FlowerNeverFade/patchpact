import { spawn } from "node:child_process";
import { resolve } from "node:path";

const app = process.env.PATCHPACT_APP ?? "web";
const targets = {
  web: "apps/web/dist/index.js",
  worker: "apps/worker/dist/index.js",
  cli: "apps/cli/dist/index.js",
};

const target = targets[app];

if (!target) {
  console.error(`Unknown PATCHPACT_APP "${app}". Expected one of: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(process.cwd(), target), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
