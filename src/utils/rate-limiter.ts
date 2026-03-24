export const BATCH_SIZE = 4;
export const INTER_BATCH_DELAY_MS = 500;

export async function rateLimitedBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number = BATCH_SIZE,
  delayMs: number = INTER_BATCH_DELAY_MS,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);

    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
