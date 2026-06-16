// Monorepo Metro config (Expo "Work with monorepos" guide).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so @musex/core source changes are picked up.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the package first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. @musex/core ships TS source via package.json "exports"; package-exports
//    resolution is on by default in SDK 56. Keep it explicit.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
