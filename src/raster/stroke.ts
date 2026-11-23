/**
 * Brush stroke geometry, independent of any canvas: where along the pointer's
 * path the brush tip ("dab") is stamped, and how hard its edge is.
 */

export interface StrokePoint {
  x: number;
  y: number;
  /** 0–1; mice and fingers report 1. */
  pressure: number;
}

export interface Dab extends StrokePoint {
  /** Tip diameter at this dab, in layer pixels. */
  diameter: number;
  /** Which way the stroke is going here, radians (0 is to the right). */
  direction: number;
}

/** Photoshop's default spacing: a quarter of the tip between dabs. */
export const DEFAULT_SPACING = 0.25;

/** Thinnest tip a light stylus touch shrinks to, as a share of the size. */
const MIN_PRESSURE_SCALE = 0.05;

export const pressureDiameter = (diameter: number, pressure: number): number =>
  diameter * Math.min(1, Math.max(MIN_PRESSURE_SCALE, pressure));

/**
 * Turns pointer samples into evenly spaced dabs. Distance left over at the
 * end of one segment carries into the next, so the spacing stays even
 * however the samples arrive.
 */
export class DabSpacer {
  private last: StrokePoint | null = null;
  /** Distance travelled since the last dab. */
  private travelled = 0;

  constructor(
    private readonly diameter: number,
    private readonly spacing = DEFAULT_SPACING,
    /** Pen pressure shrinks the tip (Photoshop's Size control: Pen Pressure). */
    private readonly pressureSize = true
  ) {}

  private sizeAt(pressure: number): number {
    return this.pressureSize ? pressureDiameter(this.diameter, pressure) : this.diameter;
  }

  private stepAt(pressure: number): number {
    return Math.max(0.5, this.sizeAt(pressure) * this.spacing);
  }

  /** The dabs from the previous sample up to this one (the first sample dabs once). */
  add(point: StrokePoint): Dab[] {
    const dabs: Dab[] = [];
    const last = this.last;
    this.last = point;
    if (!last) {
      dabs.push({ ...point, diameter: this.sizeAt(point.pressure), direction: 0 });
      this.travelled = 0;
      return dabs;
    }
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return dabs;
    const direction = Math.atan2(dy, dx);

    let position = 0;
    // Distance still to go before the next dab is due.
    let remaining = this.stepAt(last.pressure) - this.travelled;
    while (position + remaining <= length) {
      position += remaining;
      const t = position / length;
      const pressure = last.pressure + (point.pressure - last.pressure) * t;
      dabs.push({
        x: last.x + dx * t,
        y: last.y + dy * t,
        pressure,
        diameter: this.sizeAt(pressure),
        direction,
      });
      remaining = this.stepAt(pressure);
    }
    this.travelled = this.stepAt(point.pressure) - (remaining - (length - position));
    return dabs;
  }
}

/**
 * Opacity of a round tip at a distance from its centre, as a share of the
 * radius. Fully hard tips keep a one-pixel antialiased rim; softer ones fade
 * smoothly from the hard core to the edge.
 */
export function tipAlpha(distance: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  if (distance >= radius) return 0;
  const core = Math.min(radius * hardness, radius - Math.min(1, radius));
  if (distance <= core) return 1;
  const t = (distance - core) / (radius - core);
  // Smoothstep from 1 to 0.
  return 1 - t * t * (3 - 2 * t);
}

/** Colour stops for a radial gradient that draws the tip (offsets 0–1). */
export function tipGradientStops(radius: number, hardness: number): [number, number][] {
  const stops: [number, number][] = [];
  const samples = 12;
  const core = Math.min(radius * hardness, radius - Math.min(1, radius));
  const coreOffset = radius > 0 ? core / radius : 0;
  stops.push([0, 1]);
  if (coreOffset > 0) stops.push([coreOffset, 1]);
  for (let index = 1; index <= samples; index += 1) {
    const offset = coreOffset + ((1 - coreOffset) * index) / samples;
    stops.push([offset, tipAlpha(offset * radius, radius, hardness)]);
  }
  return stops;
}
