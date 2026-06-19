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
    archive: "zip",
  },
  // zhongfly/mpv-winbuild x64 — a fully static build (DLLs linked into the
  // ~118MB mpv.exe; the archive root has mpv.exe + mpv.com + fonts.conf). The
  // .7z is fetched + 7z-extracted only on Windows (the macOS/Linux dev boxes
  // never hit this branch); 7-Zip is pre-installed on the windows-latest runner.
  "win32-x64": {
    url: "https://github.com/zhongfly/mpv-winbuild/releases/download/2026-06-18-2d5dfb343a/mpv-x86_64-20260618-git-2d5dfb343a.7z",
    sha256: "a56188d75e4450f48bcaf465d29fac4d66ac35aed011d6606852674edbd364ed",
    binaryRelPath: "mpv.exe", // mpv.exe is at the archive root
    archive: "7z",
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

  const archiveKind = pin.archive ?? "zip";
  const vendorDir = join(repoRoot, "vendor");
  await mkdir(vendorDir, { recursive: true });
  const tmpDir = await mkdtemp(join(tmpdir(), "musex-mpv-"));
  const archivePath = join(vendorDir, `mpv-download-${process.pid}.${archiveKind}`);

  try {
    // Download
    const res = await fetch(pin.url);
    if (!res.ok || !res.body) {
      throw new Error(`download failed: ${res.status} ${res.statusText} for ${pin.url}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archivePath));

    // Verify sha256
    const actual = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    if (actual !== pin.sha256) {
      throw new Error(`sha256 mismatch for ${pin.url}\n  expected: ${pin.sha256}\n  actual:   ${actual}`);
    }

    await mkdir(targetDir, { recursive: true });

    if (archiveKind === "7z") {
      // Windows: a zhongfly mpv-winbuild .7z — mpv.exe + companions at the
      // archive root, extracted flat into targetDir. 7-Zip is pre-installed on
      // the windows-latest runner (try `7z` then `7za` then `7zz`); this branch
      // only runs when process.platform === "win32".
      extract7z(archivePath, targetDir);
    } else {
      // macOS: a zip containing mpv.tar.gz, which contains mpv.app/.
      execFileSync("unzip", ["-o", "-q", archivePath, "-d", tmpDir]);
      execFileSync("tar", ["-xzf", join(tmpDir, "mpv.tar.gz"), "-C", targetDir]);
    }

    // The mpv distribution ships some files read-only (e.g. libMoltenVK.dylib
    // at mode 444). Squirrel.Mac's ShipIt must remove the quarantine xattr
    // from every file of an update, which requires owner-write — a single
    // read-only file makes EVERY auto-update fail with "Permission denied"
    // and silently relaunch the old version. Normalize to owner-writable.
    // (chmod is a Unix tool; skip on Windows, where file modes don't apply.)
    if (process.platform !== "win32") {
      execFileSync("chmod", ["-R", "u+w", targetDir]);
    }

    // Sanity check. macOS pins mpv v0.41.0; the Windows winbuild is a dated
    // git build, so only assert the binary runs and self-identifies as mpv.
    const versionOut = execFileSync(binaryPath, ["--version"], { encoding: "utf8" });
    const expectVersion = archiveKind === "7z" ? "mpv" : `mpv ${MPV_VERSION}`;
    if (!versionOut.includes(expectVersion)) {
      throw new Error(`mpv --version sanity check failed; output:\n${versionOut}`);
    }

    console.log(`vendored mpv (${key})`);
  } finally {
    await rm(archivePath, { force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Extract a .7z into destDir, trying the binaries that may be on PATH
 *  (`7z` / `7za` / `7zz`). Throws if none is available or extraction fails. */
function extract7z(archivePath, destDir) {
  const candidates = ["7z", "7za", "7zz"];
  let lastErr;
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["x", "-y", `-o${destDir}`, archivePath], { stdio: "inherit" });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `7z extraction failed — no working 7-Zip binary (tried ${candidates.join(", ")}): ${String(lastErr)}`,
  );
}

main().catch((err) => {
  console.error(`fetch-mpv: ${err?.message ?? err}`);
  process.exitCode = 1;
});
