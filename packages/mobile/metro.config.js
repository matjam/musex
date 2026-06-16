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

// 4. @musex/core's TS source uses NodeNext-style ".js" import specifiers (e.g.
//    `import { buildQueue } from "../usecases/build-queue.js"` where the real
//    file is build-queue.ts). Vite/tsc rewrite .js->.ts automatically; Metro
//    does not. Rewrite .js->.ts for relative imports originating INSIDE
//    packages/core (all .ts there), scoped so real .js modules elsewhere are
//    untouched.
const coreDir = `${path.sep}packages${path.sep}core${path.sep}`;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // context.resolveRequest is Metro's default resolver (documented chaining API).
  if (
    context.originModulePath.includes(coreDir) &&
    /^\.\.?\//.test(moduleName) &&
    moduleName.endsWith(".js")
  ) {
    return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
