import { spawnSync } from "node:child_process";

const steps = [
  ["node", ["scripts/build-extension.mjs"]],
  ["node", ["scripts/run-framework.mjs", "build"]],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
