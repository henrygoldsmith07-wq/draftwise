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

// The committed lockfile contains a mixed React/Vinext toolchain. Restore it first
// without re-resolving peer ranges, then normalize the runtime-only incompatibilities
// below so CI can exercise the product rather than fail in dependency setup.
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

const readInstalledVersion = (name) => {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, "node_modules", name, "package.json"), "utf8"),
    );
    if (typeof manifest.version !== "string" || !manifest.version) {
      throw new Error("package version is missing");
    }
    return manifest.version;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to verify installed ${name}: ${detail}`);
  }
};

const installRuntimePackages = (...specifiers) => {
  const result = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath, "install", ...specifiers, "--no-save",
      "--prefix", projectRoot, "--workspaces=false", "--legacy-peer-deps",
      "--prefer-offline", "--no-audit", "--no-fund",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Vinext 1.0.0-beta.10's callable `use cache` plugin requires plugin-rsc >=0.5.34.
// The committed graph currently pins 0.5.26, which lets every test/evaluation pass
// but crashes the production build during Vite config resolution. Normalize the CI
// runtime to the minimum compatible release and verify the result fail-closed.
const minimumPluginRsc = [0, 5, 34];
const parseVersion = (version) => version.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10));
const versionAtLeast = (version, minimum) => {
  const parsed = parseVersion(version);
  if (parsed.length !== 3 || parsed.some((part) => !Number.isInteger(part))) return false;
  return parsed.some((part, index) => part > minimum[index] && parsed.slice(0, index).every((value, prior) => value === minimum[prior]))
    || parsed.every((part, index) => part === minimum[index]);
};

let pluginRscVersion = readInstalledVersion("@vitejs/plugin-rsc");
if (!versionAtLeast(pluginRscVersion, minimumPluginRsc)) {
  console.warn(`Normalizing CI @vitejs/plugin-rsc runtime: installed=${pluginRscVersion}, required>=0.5.34.`);
  installRuntimePackages("@vitejs/plugin-rsc@0.5.34");
  pluginRscVersion = readInstalledVersion("@vitejs/plugin-rsc");
}
if (!versionAtLeast(pluginRscVersion, minimumPluginRsc)) {
  console.error(`Vinext runtime mismatch after CI install: @vitejs/plugin-rsc=${pluginRscVersion}, required>=0.5.34.`);
  process.exitCode = 69;
}

// npm install above can re-resolve transitive peer dependencies. React requires react
// and react-dom to be byte-for-byte version peers, so enforce and verify that invariant
// only after every runtime normalization has completed.
const reactVersion = readInstalledVersion("react");
let reactDomVersion = readInstalledVersion("react-dom");
if (reactDomVersion !== reactVersion) {
  console.warn(
    `Normalizing CI React runtime: react=${reactVersion}, react-dom=${reactDomVersion}.`,
  );
  installRuntimePackages(`react-dom@${reactVersion}`, "@vitejs/plugin-rsc@0.5.34");
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
