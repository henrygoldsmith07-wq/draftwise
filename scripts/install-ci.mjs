import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";

if (!process.env.npm_execpath) {
  throw new Error("Run this installer with npm run install:ci.");
}

if (![
  "SHARP_IGNORE_GLOBAL_LIBVIPS",
  "SHARP_FORCE_GLOBAL_LIBVIPS",
  "npm_config_build_from_source",
  "NPM_CONFIG_BUILD_FROM_SOURCE",
].some((key) => key in process.env)) {
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = "1";
}

if (readExecutionProfile() === "managed-linux") {
  const result = spawnSync("bash", [path.join(projectRoot, "scripts/install-ci.sh")], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// The committed lockfile contains a mixed React toolchain used by Next/Vinext.
// npm's modern peer resolver can reject that already-locked graph before CI reaches
// product checks, so restore the lockfile first without re-resolving peer ranges.
const installed = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath, "ci", "--prefix", projectRoot, "--workspaces=false",
    "--include=dev", "--include=optional", "--legacy-peer-deps", "--prefer-offline",
    "--no-audit", "--no-fund",
  ],
  { stdio: "inherit" },
);
if (installed.error) throw installed.error;
if (installed.status !== 0) process.exit(installed.status ?? 1);

// React itself requires react and react-dom to be byte-for-byte version peers at
// runtime. The repository lock currently resolves react-dom ahead of react, which
// makes the production server build crash before application code is evaluated.
// Normalize the installed CI graph to the pinned React version without rewriting
// package.json/package-lock.json; the lockfile remains the reproducible source graph.
const readInstalledVersion = (name) => JSON.parse(
  readFileSync(path.join(projectRoot, "node_modules", name, "package.json"), "utf8"),
).version;

const reactVersion = readInstalledVersion("react");
let reactDomVersion = readInstalledVersion("react-dom");
if (reactDomVersion !== reactVersion) {
  console.warn(
    `Normalizing CI React runtime: react=${reactVersion}, react-dom=${reactDomVersion}.`,
  );
  const normalized = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath, "install", `react-dom@${reactVersion}`, "--no-save",
      "--prefix", projectRoot, "--workspaces=false", "--legacy-peer-deps",
      "--prefer-offline", "--no-audit", "--no-fund",
    ],
    { stdio: "inherit" },
  );
  if (normalized.error) throw normalized.error;
  if (normalized.status !== 0) process.exit(normalized.status ?? 1);
  reactDomVersion = readInstalledVersion("react-dom");
}

if (reactDomVersion !== reactVersion) {
  console.error(
    `React runtime mismatch after CI install: react=${reactVersion}, react-dom=${reactDomVersion}.`,
  );
  process.exitCode = 69;
}

try {
  accessSync(
    path.join(
      projectRoot, "node_modules", ".bin",
      process.platform === "win32" ? "vinext.cmd" : "vinext",
    ),
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  );
} catch {
  console.error("npm ci exited successfully but the local vinext executable is unavailable.");
  process.exitCode = 69;
}
