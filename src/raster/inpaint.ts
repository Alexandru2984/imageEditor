import { membraneFill } from "./heal";

/**
 * Content-aware fill: rebuild the pixels of a hole from patches of the rest
 * of the image, as Photoshop's Content-Aware Fill and Spot Healing brush do.
 *
 * It is the classic multi-scale method (Wexler, Shechtman and Irani 2007,
 * with Barnes et al.'s PatchMatch 2009 to find the patches): from a small
 * copy of the image up to the full size, find for every patch touching the
 * hole the most similar patch outside it, then let the patches vote on each
 * hole pixel's colour, and repeat.
 */

/** Patches are 7 × 7 pixels. */
const RADIUS = 3;
const SIDE = RADIUS * 2 + 1;
/** No level is made smaller than this many patches across. */
const MIN_PATCHES_ACROSS = 6;

interface Level {
  width: number;
  height: number;
  /** RGBA, 0–255. */
  image: Float32Array;
  /** 1 where the pixel is to be filled. */
  hole: Uint8Array;
}

/** Mulberry32: small, fast and seeded, so a fill is repeatable. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function holeExtent(level: Level): number {
  let left = level.width;
  let right = -1;
  let top = level.height;
  let bottom = -1;
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      if (!level.hole[y * level.width + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? 0 : Math.max(right - left + 1, bottom - top + 1);
}

/** Half the size: known pixels average their known children; any hole child makes a hole. */
function downscale(level: Level): Level {
  const width = Math.ceil(level.width / 2);
  const height = Math.ceil(level.height / 2);
  const image = new Float32Array(width * height * 4);
  const hole = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let known = 0;
      let anyHole = 0;
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy += 1) {
        const fy = y * 2 + dy;
        if (fy >= level.height) continue;
        for (let dx = 0; dx < 2; dx += 1) {
          const fx = x * 2 + dx;
          if (fx >= level.width) continue;
          const at = fy * level.width + fx;
          if (level.hole[at]) {
            anyHole = 1;
            continue;
          }
          known += 1;
          for (let channel = 0; channel < 4; channel += 1) sum[channel]! += level.image[at * 4 + channel]!;
        }
      }
      const at = y * width + x;
      hole[at] = anyHole;
      if (known > 0) for (let channel = 0; channel < 4; channel += 1) image[at * 4 + channel] = sum[channel]! / known;
    }
  }
  return { width, height, image, hole };
}

/** Number of hole pixels in each patch-sized window, from a summed-area table. */
function holeCounter(level: Level) {
  const { width, height, hole } = level;
  const table = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += hole[y * width + x]!;
      table[(y + 1) * (width + 1) + x + 1] = table[y * (width + 1) + x + 1]! + row;
    }
  }
  return (x0: number, y0: number, x1: number, y1: number) => {
    const left = Math.max(0, x0);
    const top = Math.max(0, y0);
    const right = Math.min(width, x1);
    const bottom = Math.min(height, y1);
    if (right <= left || bottom <= top) return 0;
    return (
      table[bottom * (width + 1) + right]! -
      table[top * (width + 1) + right]! -
      table[bottom * (width + 1) + left]! +
      table[top * (width + 1) + left]!
    );
  };
}

/** Squared colour distance between the patches around two pixels, stopping once over `limit`. */
function patchDistance(level: Level, px: number, py: number, qx: number, qy: number, limit: number): number {
  const { width, height, image } = level;
  let sum = 0;
  for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
    const ty = py + dy;
    if (ty < 0 || ty >= height) continue;
    const targetRow = ty * width;
    const sourceRow = (qy + dy) * width;
    for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
      const tx = px + dx;
      if (tx < 0 || tx >= width) continue;
      const t = (targetRow + tx) * 4;
      const s = (sourceRow + qx + dx) * 4;
      const d0 = image[t]! - image[s]!;
      const d1 = image[t + 1]! - image[s + 1]!;
      const d2 = image[t + 2]! - image[s + 2]!;
      const d3 = image[t + 3]! - image[s + 3]!;
      sum += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
    }
    if (sum > limit) return sum;
  }
  return sum;
}

/** How many pixels of the patch around a pixel lie on the image. */
const patchArea = (level: Level, x: number, y: number) =>
  (Math.min(RADIUS, level.width - 1 - x) + Math.min(RADIUS, x) + 1) *
  (Math.min(RADIUS, level.height - 1 - y) + Math.min(RADIUS, y) + 1);

interface Field {
  /** Pixels whose patch touches the hole, in scan order. */
  targets: Int32Array;
  /** Each target's slot in `targets`, or -1. */
  slotOf: Int32Array;
  /** Each target's best source pixel. */
  match: Int32Array;
  /** Its distance. */
  distance: Float32Array;
}

class LevelSolver {
  private readonly valid: Uint8Array;
  private readonly sources: Int32Array;
  readonly field: Field;

  constructor(
    private readonly level: Level,
    private readonly next: () => number,
    previous: { field: Field; width: number } | null
  ) {
    const { width, height } = level;
    const count = holeCounter(level);
    this.valid = new Uint8Array(width * height);
    const sources: number[] = [];
    for (let y = RADIUS; y < height - RADIUS; y += 1) {
      for (let x = RADIUS; x < width - RADIUS; x += 1) {
        if (count(x - RADIUS, y - RADIUS, x + RADIUS + 1, y + RADIUS + 1) === 0) {
          this.valid[y * width + x] = 1;
          sources.push(y * width + x);
        }
      }
    }
    this.sources = Int32Array.from(sources);

    const targets: number[] = [];
    const slotOf = new Int32Array(width * height).fill(-1);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (count(x - RADIUS, y - RADIUS, x + RADIUS + 1, y + RADIUS + 1) > 0) {
          slotOf[y * width + x] = targets.length;
          targets.push(y * width + x);
        }
      }
    }
    this.field = {
      targets: Int32Array.from(targets),
      slotOf,
      match: new Int32Array(targets.length),
      distance: new Float32Array(targets.length),
    };
    if (this.sources.length > 0) this.initialise(previous);
  }

  get usable(): boolean {
    return this.sources.length > 0;
  }

  private randomSource(): number {
    return this.sources[Math.floor(this.next() * this.sources.length)]!;
  }

  /** Start from the coarser level's matches, scaled up, or at random. */
  private initialise(previous: { field: Field; width: number } | null) {
    const { width, height } = this.level;
    const { targets, match } = this.field;
    for (let slot = 0; slot < targets.length; slot += 1) {
      const at = targets[slot]!;
      const x = at % width;
      const y = (at - x) / width;
      let source = -1;
      if (previous) {
        const coarseSlot = previous.field.slotOf[Math.floor(y / 2) * previous.width + Math.floor(x / 2)]!;
        if (coarseSlot >= 0) {
          const coarse = previous.field.match[coarseSlot]!;
          const cx = coarse % previous.width;
          const cy = (coarse - cx) / previous.width;
          const sx = Math.min(width - 1 - RADIUS, Math.max(RADIUS, cx * 2 + (x % 2)));
          const sy = Math.min(height - 1 - RADIUS, Math.max(RADIUS, cy * 2 + (y % 2)));
          if (this.valid[sy * width + sx]) source = sy * width + sx;
        }
      }
      match[slot] = source >= 0 ? source : this.randomSource();
    }
    this.measure();
  }

  private measure() {
    const { width } = this.level;
    const { targets, match, distance } = this.field;
    for (let slot = 0; slot < targets.length; slot += 1) {
      const at = targets[slot]!;
      const source = match[slot]!;
      const x = at % width;
      const sx = source % width;
      distance[slot] = patchDistance(this.level, x, (at - x) / width, sx, (source - sx) / width, Infinity);
    }
  }

  private tryMatch(slot: number, px: number, py: number, sx: number, sy: number) {
    const { width } = this.level;
    const source = sy * width + sx;
    const { match, distance } = this.field;
    if (source === match[slot] || !this.valid[source]) return;
    const best = distance[slot]!;
    const candidate = patchDistance(this.level, px, py, sx, sy, best);
    if (candidate < best) {
      match[slot] = source;
      distance[slot] = candidate;
    }
  }

  /** PatchMatch: spread good matches to neighbours, then look around them at random. */
  search(passes: number, searchRadius: number) {
    const { width, height } = this.level;
    const { targets, slotOf, match } = this.field;
    // The patch on the image moves on, distances are stale.
    this.measure();
    for (let pass = 0; pass < passes; pass += 1) {
      const forward = pass % 2 === 0;
      const step = forward ? 1 : -1;
      for (let index = 0; index < targets.length; index += 1) {
        const slot = forward ? index : targets.length - 1 - index;
        const at = targets[slot]!;
        const x = at % width;
        const y = (at - x) / width;
        // Propagation: the neighbour's match, shifted along.
        for (const neighbour of [at - step, at - step * width]) {
          if (neighbour < 0 || neighbour >= width * height) continue;
          if (neighbour === at - step && (forward ? x === 0 : x === width - 1)) continue;
          const neighbourSlot = slotOf[neighbour]!;
          if (neighbourSlot < 0) continue;
          const theirs = match[neighbourSlot]!;
          const tx = theirs % width;
          const ty = (theirs - tx) / width;
          const sx = tx + (x - (neighbour % width));
          const sy = ty + (y - Math.floor(neighbour / width));
          if (sx < RADIUS || sy < RADIUS || sx >= width - RADIUS || sy >= height - RADIUS) continue;
          this.tryMatch(slot, x, y, sx, sy);
        }
        // Random search in shrinking windows around the current match.
        const current = match[slot]!;
        const cx = current % width;
        const cy = (current - cx) / width;
        for (let radius = searchRadius; radius >= 1; radius = Math.floor(radius / 2)) {
          const sx = Math.min(width - 1 - RADIUS, Math.max(RADIUS, cx + Math.round((this.next() * 2 - 1) * radius)));
          const sy = Math.min(height - 1 - RADIUS, Math.max(RADIUS, cy + Math.round((this.next() * 2 - 1) * radius)));
          this.tryMatch(slot, x, y, sx, sy);
        }
      }
    }
  }

  /** Each hole pixel becomes the weighted average of what the patches over it propose. */
  vote() {
    const { width, height, image, hole } = this.level;
    const { targets, match, distance } = this.field;
    // Similar patches count more; "similar" is judged against the typical match.
    const means = new Float32Array(targets.length);
    for (let slot = 0; slot < targets.length; slot += 1) {
      const at = targets[slot]!;
      const x = at % width;
      means[slot] = distance[slot]! / patchArea(this.level, x, (at - x) / width);
    }
    const sorted = Float32Array.from(means).sort();
    const typical = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const scale = 1 / (2 * typical + 1);

    const sums = new Float32Array(width * height * 4);
    const weights = new Float32Array(width * height);
    for (let slot = 0; slot < targets.length; slot += 1) {
      const at = targets[slot]!;
      const px = at % width;
      const py = (at - px) / width;
      const source = match[slot]!;
      const sx = source % width;
      const sy = (source - sx) / width;
      const weight = Math.exp(-means[slot]! * scale);
      for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
        const ty = py + dy;
        if (ty < 0 || ty >= height) continue;
        for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
          const tx = px + dx;
          if (tx < 0 || tx >= width) continue;
          const target = ty * width + tx;
          if (!hole[target]) continue;
          const from = ((sy + dy) * width + sx + dx) * 4;
          sums[target * 4]! += weight * image[from]!;
          sums[target * 4 + 1]! += weight * image[from + 1]!;
          sums[target * 4 + 2]! += weight * image[from + 2]!;
          sums[target * 4 + 3]! += weight * image[from + 3]!;
          weights[target]! += weight;
        }
      }
    }
    for (let at = 0; at < width * height; at += 1) {
      const weight = weights[at]!;
      if (!hole[at] || weight <= 0) continue;
      for (let channel = 0; channel < 4; channel += 1) image[at * 4 + channel] = sums[at * 4 + channel]! / weight;
    }
  }
}

/** Fill the hole smoothly from its edges: the starting guess, and the fallback. */
function smoothFill(level: Level) {
  const known = new Uint8Array(level.hole.length);
  for (let at = 0; at < known.length; at += 1) known[at] = level.hole[at] ? 0 : 1;
  membraneFill(level.image, known, level.width, level.height, 4, 30);
}

/**
 * The image with the pixels where `hole` is non-zero filled in from the
 * rest of it. `pixels` is RGBA, `width` × `height`; it is not changed.
 */
export function inpaint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  seed = 1
): Uint8ClampedArray {
  const base: Level = { width, height, image: Float32Array.from(pixels), hole: Uint8Array.from(hole, (value) => (value ? 1 : 0)) };
  const levels: Level[] = [base];
  for (;;) {
    const level = levels[levels.length - 1]!;
    const smallest = Math.min(level.width, level.height);
    if (smallest / 2 < SIDE * MIN_PATCHES_ACROSS || holeExtent(level) <= SIDE) break;
    levels.push(downscale(level));
  }

  const next = random(seed);
  const coarsest = levels[levels.length - 1]!;
  smoothFill(coarsest);
  let previous: { field: Field; width: number } | null = null;
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index]!;
    if (index < levels.length - 1) {
      // Start from the coarser result, scaled up, where the hole is.
      const coarse = levels[index + 1]!;
      for (let y = 0; y < level.height; y += 1) {
        for (let x = 0; x < level.width; x += 1) {
          const at = y * level.width + x;
          if (!level.hole[at]) continue;
          const from = (Math.min(coarse.height - 1, y >> 1) * coarse.width + Math.min(coarse.width - 1, x >> 1)) * 4;
          for (let channel = 0; channel < 4; channel += 1) level.image[at * 4 + channel] = coarse.image[from + channel]!;
        }
      }
    }
    const solver: LevelSolver = new LevelSolver(level, next, previous);
    if (!solver.usable) {
      if (index === levels.length - 1) continue;
      smoothFill(level);
      previous = null;
      continue;
    }
    const finest = index === 0;
    const rounds = finest ? 2 : index === levels.length - 1 ? 6 : 3;
    const radius = index === levels.length - 1 ? Math.max(level.width, level.height) : Math.min(Math.max(level.width, level.height), 64);
    for (let round = 0; round < rounds; round += 1) {
      solver.search(finest ? 2 : 3, radius);
      solver.vote();
    }
    previous = { field: solver.field, width: level.width };
  }

  const result = new Uint8ClampedArray(pixels);
  for (let at = 0; at < base.hole.length; at += 1) {
    if (!base.hole[at]) continue;
    for (let channel = 0; channel < 4; channel += 1) result[at * 4 + channel] = base.image[at * 4 + channel]!;
  }
  return result;
}
