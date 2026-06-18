// js-sha256 ships no types and there is no @types/js-sha256. The module's
// runtime callable is resolved across interops in sha256.ts; this declares the
// minimal surface that resolution touches.
declare module "js-sha256" {
  const sha256: ((input: string) => string) & { sha256?: (input: string) => string };
  export = sha256;
}
