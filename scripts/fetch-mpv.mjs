// Provisions a pinned, checksum-verified mpv binary into vendor/mpv/<platform-arch>/.
// Idempotent: exits immediately if the binary is already present. No npm dependencies.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const PINS = {
  "darwin-arm64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip",
    sha256: "5c96f9b21355fc0a11d2e2161ad65f33031070e9fb3f6bd9865fb459b94587e6",
    binaryRelPath: "mpv.app/Contents/MacOS/mpv",
  },
};

const MPV_VERSION = "v0.41.0";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const key = `${process.platform}-${process.arch}`;

  if (process.platform === "linux") {
    console.log("fetch-mpv: Linux uses system mpv — nothing to vendor");
    return;
  }

  const pin = PINS[key];
  if (!pin) {
    console.error(`fetch-mpv: no mpv pin for ${key}`);
    process.exitCode = 1;
    return;
  }

  const targetDir = join(repoRoot, "vendor", "mpv", key);
  const binaryPath = join(targetDir, pin.binaryRelPath);
  if (existsSync(binaryPath)) {
    return; // already provisioned
  }

  const vendorDir = join(repoRoot, "vendor");
  await mkdir(vendorDir, { recursive: true });
  const tmpDir = await mkdtemp(join(tmpdir(), "musex-mpv-"));
  const zipPath = join(vendorDir, `mpv-download-${process.pid}.zip`);

  try {
    // Download
    const res = await fetch(pin.url);
    if (!res.ok || !res.body) {
      throw new Error(`download failed: ${res.status} ${res.statusText} for ${pin.url}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

    // Verify sha256
    const actual = createHash("sha256")
      .update(await readFile(zipPath))
      .digest("hex");
    if (actual !== pin.sha256) {
      throw new Error(`sha256 mismatch for ${pin.url}\n  expected: ${pin.sha256}\n  actual:   ${actual}`);
    }

    // Extract: zip contains mpv.tar.gz, which contains mpv.app/
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmpDir]);
    await mkdir(targetDir, { recursive: true });
    execFileSync("tar", ["-xzf", join(tmpDir, "mpv.tar.gz"), "-C", targetDir]);

    // The mpv distribution ships some files read-only (e.g. libMoltenVK.dylib
    // at mode 444). Squirrel.Mac's ShipIt must remove the quarantine xattr
    // from every file of an update, which requires owner-write — a single
    // read-only file makes EVERY auto-update fail with "Permission denied"
    // and silently relaunch the old version. Normalize to owner-writable.
    execFileSync("chmod", ["-R", "u+w", targetDir]);

    // Sanity check
    const versionOut = execFileSync(binaryPath, ["--version"], { encoding: "utf8" });
    if (!versionOut.includes(`mpv ${MPV_VERSION}`)) {
      throw new Error(`mpv --version sanity check failed; output:\n${versionOut}`);
    }

    console.log(`vendored mpv ${MPV_VERSION} (${key})`);
  } finally {
    await rm(zipPath, { force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`fetch-mpv: ${err?.message ?? err}`);
  process.exitCode = 1;
});
