import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Stages a store-uploadable extension directory and zips it when a zip tool
 * exists. Run after `npm run extension:build` (the `extension:package`
 * script chains it) so the shared bundles are current.
 *
 * The zip step is best-effort across platforms: `zip` where present (CI),
 * bsdtar's `-a` (Windows/macOS) otherwise. GNU tar cannot write zips, so it
 * is detected and skipped rather than producing a misnamed tar. When no tool
 * exists the staged directory is still complete and the manual command is
 * printed — a real fallback, not a silent half-package.
 */

const root = process.cwd();
const sourceDir = join(root, "extension");
const stageRoot = join(root, "dist", "extension");

function fail(message) {
  console.error(`package-extension: ${message}`);
  process.exit(1);
}

function collectFiles(manifest) {
  const files = new Set(["manifest.json", manifest.background?.service_worker, manifest.options_ui?.page, manifest.action?.default_popup]);
  for (const icon of [...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {})]) {
    files.add(icon);
  }
  return [...files].filter(Boolean);
}

async function tryZip(zipPath) {
  const zip = spawnSync("zip", ["-r", "-X", zipPath, "extension"], { cwd: join(root, "dist"), stdio: "inherit", shell: false });
  if (!zip.error) return zip.status === 0;
  // bsdtar (Windows' tar.exe, macOS tar) writes real zips with -a; GNU tar
  // does not, so check the flavour before trusting it with a .zip name.
  // Git Bash on Windows shadows tar.exe with its own GNU tar, so also try
  // the genuine bsdtar that ships with Windows itself.
  const candidates = process.platform === "win32"
    ? ["tar.exe", "tar", join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")]
    : ["tar"];
  for (const candidate of candidates) {
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8", shell: false });
    const output = typeof version.stdout === "string" ? version.stdout : "";
    if (version.error || output.includes("GNU tar")) continue;
    const tar = spawnSync(candidate, ["-a", "-c", "-f", zipPath, "extension"], { cwd: join(root, "dist"), stdio: "inherit", shell: false });
    if (!tar.error) return tar.status === 0;
  }
  return false;
}

const manifest = JSON.parse(await readFile(join(sourceDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}; bump them together.`);
}
for (const name of collectFiles(manifest)) {
  const info = await stat(join(sourceDir, name)).catch(() => null);
  if (!info?.isFile()) fail(`manifest references ${name}, which is missing from extension/.`);
}
for (const bundle of ["shared-analysis.js", "shared-provider.js"]) {
  const info = await stat(join(sourceDir, bundle));
  if (info.size === 0) fail(`${bundle} is empty; run npm run extension:build first.`);
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });
for (const entry of await readdir(sourceDir)) {
  if (entry === "README.md") continue;
  await cp(join(sourceDir, entry), join(stageRoot, entry), { recursive: false });
}

const zipName = `draftwise-extension-${manifest.version}.zip`;
const zipPath = join(root, "dist", zipName);
if (await tryZip(zipPath)) {
  console.log(`Extension packaged: dist/${zipName}`);
} else {
  console.log(`Extension staged at dist/extension/ (no zip tool found). Zip it with: zip -r -X dist/${zipName} extension`);
}
