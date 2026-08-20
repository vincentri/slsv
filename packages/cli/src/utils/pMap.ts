// Bounded-concurrency map: run `worker` over `items` with at most `limit` in flight.
// ponytail: inline pool, no p-limit dep. limit=8 stays well under Lambda's API rate; raise
// if deploys of huge apps still bottleneck (or drop to a real limiter if backpressure matters).
export async function pMap<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
