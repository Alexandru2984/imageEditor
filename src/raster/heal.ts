/**
 * Smooth interpolation into unknown pixels, the core of the Healing brush:
 * the difference between the destination and the copied pixels is known
 * around a stroke and spread smoothly across it, so the copy takes on the
 * colour and light of where it lands (a membrane, or Poisson, fill).
 */

interface Level {
  width: number;
  height: number;
  values: Float32Array;
  weights: Float32Array;
}

/**
 * Fill the unknown entries of `values` (`width` × `height` pixels of
 * `channels` each) from the known ones (non-zero in `known`), smoothly:
 * pull-push gives every gap the average of what surrounds it at its own
 * scale, then relaxation evens it out towards the true membrane. Returns
 * false (and changes nothing) when nothing is known.
 */
export function membraneFill(
  values: Float32Array,
  known: Uint8Array,
  width: number,
  height: number,
  channels: number,
  iterations = 60
): boolean {
  const base: Level = { width, height, values: new Float32Array(values), weights: new Float32Array(width * height) };
  let any = false;
  for (let index = 0; index < known.length; index += 1) {
    if (known[index]) {
      base.weights[index] = 1;
      any = true;
    }
  }
  if (!any) return false;

  // Pull: each coarser level averages the known values below it.
  const levels: Level[] = [base];
  const sums = new Float32Array(channels);
  let level = base;
  while (level.width > 1 || level.height > 1) {
    const coarseWidth = Math.ceil(level.width / 2);
    const coarseHeight = Math.ceil(level.height / 2);
    const coarse: Level = {
      width: coarseWidth,
      height: coarseHeight,
      values: new Float32Array(coarseWidth * coarseHeight * channels),
      weights: new Float32Array(coarseWidth * coarseHeight),
    };
    for (let y = 0; y < coarseHeight; y += 1) {
      for (let x = 0; x < coarseWidth; x += 1) {
        let weight = 0;
        sums.fill(0);
        for (let dy = 0; dy < 2; dy += 1) {
          const fineY = y * 2 + dy;
          if (fineY >= level.height) continue;
          for (let dx = 0; dx < 2; dx += 1) {
            const fineX = x * 2 + dx;
            if (fineX >= level.width) continue;
            const fine = fineY * level.width + fineX;
            const fineWeight = level.weights[fine]!;
            if (fineWeight <= 0) continue;
            weight += fineWeight;
            for (let channel = 0; channel < channels; channel += 1) {
              sums[channel]! += fineWeight * level.values[fine * channels + channel]!;
            }
          }
        }
        const at = y * coarseWidth + x;
        if (weight > 0) {
          for (let channel = 0; channel < channels; channel += 1) {
            coarse.values[at * channels + channel] = sums[channel]! / weight;
          }
        }
        coarse.weights[at] = Math.min(1, weight);
      }
    }
    levels.push(coarse);
    level = coarse;
  }

  // Push: gaps take the coarser level's values, blended by how much is known.
  for (let index = levels.length - 2; index >= 0; index -= 1) {
    const fine = levels[index]!;
    const coarse = levels[index + 1]!;
    for (let y = 0; y < fine.height; y += 1) {
      // Bilinear sample of the coarser level at this pixel's centre.
      const cy = Math.min(coarse.height - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(cy);
      const y1 = Math.min(coarse.height - 1, y0 + 1);
      const fy = cy - y0;
      for (let x = 0; x < fine.width; x += 1) {
        const at = y * fine.width + x;
        const weight = fine.weights[at]!;
        if (weight >= 1) continue;
        const cx = Math.min(coarse.width - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const x1 = Math.min(coarse.width - 1, x0 + 1);
        const fx = cx - x0;
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = (sx: number, sy: number) => coarse.values[(sy * coarse.width + sx) * channels + channel]!;
          const top = sample(x0, y0) + (sample(x1, y0) - sample(x0, y0)) * fx;
          const bottom = sample(x0, y1) + (sample(x1, y1) - sample(x0, y1)) * fx;
          const smooth = top + (bottom - top) * fy;
          const slot = at * channels + channel;
          fine.values[slot] = weight * fine.values[slot]! + (1 - weight) * smooth;
        }
        fine.weights[at] = 1;
      }
    }
  }

  // Relax the gaps towards the average of their neighbours (Gauss-Seidel,
  // over-relaxed so broad gaps settle in few passes).
  let count = 0;
  for (let index = 0; index < known.length; index += 1) if (!known[index]) count += 1;
  const unknown = new Int32Array(count);
  for (let index = 0, slot = 0; index < known.length; index += 1) if (!known[index]) unknown[slot++] = index;
  const result = base.values;
  const omega = 1.8;
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let slot = 0; slot < unknown.length; slot += 1) {
      const at = unknown[slot]!;
      const x = at % width;
      const left = x > 0 ? at - 1 : -1;
      const right = x < width - 1 ? at + 1 : -1;
      const up = at >= width ? at - width : -1;
      const down = at + width < known.length ? at + width : -1;
      const neighbours = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0) + (up >= 0 ? 1 : 0) + (down >= 0 ? 1 : 0);
      if (neighbours === 0) continue;
      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 0;
        if (left >= 0) sum += result[left * channels + channel]!;
        if (right >= 0) sum += result[right * channels + channel]!;
        if (up >= 0) sum += result[up * channels + channel]!;
        if (down >= 0) sum += result[down * channels + channel]!;
        const slotAt = at * channels + channel;
        result[slotAt] = result[slotAt]! + omega * (sum / neighbours - result[slotAt]!);
      }
    }
  }
  for (let slot = 0; slot < unknown.length; slot += 1) {
    const at = unknown[slot]!;
    for (let channel = 0; channel < channels; channel += 1) {
      values[at * channels + channel] = result[at * channels + channel]!;
    }
  }
  return true;
}
