// Intentionally duplicated in packages/sdk/src/resolve.ts — avoids cross-package dep, keeps SDK zero-dep.
// Keep in sync with packages/sdk/src/resolve.ts
export const envKey = (prefix: string, name: string) =>
  `${prefix}_${name.toUpperCase().replace(/-/g, "_")}`;
