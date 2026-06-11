// electron-builder afterPack hook (runs after packing, BEFORE signing).
//
// Squirrel.Mac's ShipIt strips the quarantine xattr from every file of an
// update, which requires owner-write permission. A single read-only file in
// the bundle (the vendored mpv ships libMoltenVK.dylib at mode 444) makes
// EVERY auto-update fail with "Permission denied" and silently relaunch the
// old version. scripts/fetch-mpv.mjs normalizes the vendor tree, and this
// hook guarantees the packaged app stays clean no matter what gets bundled
// in the future. Mode bits are not sealed by code signing, so this is safe
// to run pre-sign.
const { execFileSync } = require("node:child_process");

module.exports = async function ensureWritable(context) {
  execFileSync("chmod", ["-R", "u+w", context.appOutDir]);
};
