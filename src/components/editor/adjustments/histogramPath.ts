/**
 * A histogram as one filled shape over 256 levels, `height` tall. A few very
 * tall levels (a flat background, say) would flatten everything else, so the
 * scale stops at the third tallest.
 */
export function histogramPath(bins: Uint32Array, height: number): string {
  const sorted = [...bins].sort((a, b) => b - a);
  const top = Math.max(1, sorted[2] ?? sorted[0] ?? 1);
  let d = `M0 ${height}`;
  for (let level = 0; level < 256; level += 1) {
    const value = Math.min(1, bins[level]! / top) * height;
    d += ` L${level} ${height - value} L${level + 1} ${height - value}`;
  }
  return `${d} L256 ${height} Z`;
}
