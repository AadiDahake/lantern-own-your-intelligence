/** A small seeded generator (mulberry32), so sampling is reproducible run to run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted sampling without replacement: OS-Genesis Algorithm 1, lines 9 to 12, where each
 * trajectory is drawn with probability `weight / sum(weights)`. Returns at most `k` items.
 */
export function sampleWeighted<T>(
  items: T[],
  weight: (item: T) => number,
  k: number,
  random: () => number,
): T[] {
  const pool = items.map((item) => ({ item, w: Math.max(0, weight(item)) }));
  const out: T[] = [];
  while (out.length < k && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let pick = pool.length - 1;
    if (total > 0) {
      let r = random() * total;
      for (let i = 0; i < pool.length; i++) {
        r -= (pool[i] as { w: number }).w;
        if (r <= 0) {
          pick = i;
          break;
        }
      }
    }
    const [chosen] = pool.splice(pick, 1);
    if (chosen) out.push(chosen.item);
  }
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
