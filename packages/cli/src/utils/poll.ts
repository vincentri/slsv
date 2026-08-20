import { sleep } from "./sleep.js";

export async function pollUntil<T>(
  fn: () => Promise<T | undefined | null>,
  opts: { interval: number; timeout: number; onTick?: () => void | Promise<void> },
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < opts.timeout) {
    const result = await fn();
    if (result) return result;
    if (opts.onTick) await opts.onTick();
    if (Date.now() - start >= opts.timeout) break;
    await sleep(opts.interval);
  }
  throw new Error(`pollUntil timed out after ${opts.timeout}ms`);
}
