import type { PixelJob } from "@/raster/pixelJobs";
import { blendId } from "./blendMath";

/**
 * Adjustment layers on the GPU: the pixels under the layer go up as a
 * texture, a shader works out each one's adjusted colour (the same formulas
 * as src/raster/adjustments.ts, which stay the reference) and blends it back
 * as blendMath.ts does. Only what WebGL2 can take: otherwise the caller
 * falls back to the CPU.
 */

const VERTEX = `#version 300 es
void main() {
  // One triangle over the whole viewport.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_backdrop;
uniform sampler2D u_lut;
uniform sampler2D u_mask;
uniform ivec2 u_offset;
uniform int u_op;
uniform float u_level;
uniform vec3 u_hsl;
uniform bool u_colorize;
uniform float u_weights[6];
uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform bool u_preserve;
uniform int u_blend;
uniform float u_strength;
uniform bool u_masked;
out vec4 outColor;

float clampByte(float value) { return clamp(floor(value + 0.5), 0.0, 255.0); }

int luminosity(ivec3 c) { return (c.r * 77 + c.g * 150 + c.b * 29 + 128) >> 8; }

vec3 toHsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) / 2.0;
  float h = 0.0;
  float s = 0.0;
  float d = mx - mn;
  if (d > 0.0) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hueChannel(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

// HSL to RGB bytes.
vec3 fromHsl(float h, float s, float l) {
  if (s <= 0.0) return vec3(clampByte(l * 255.0));
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    clampByte(hueChannel(p, q, h + 1.0 / 3.0) * 255.0),
    clampByte(hueChannel(p, q, h) * 255.0),
    clampByte(hueChannel(p, q, h - 1.0 / 3.0) * 255.0)
  );
}

vec3 lutOf(int index) { return texelFetch(u_lut, ivec2(index, 0), 0).rgb * 255.0; }

// The adjusted colour, in bytes.
vec3 adjust(ivec3 c) {
  if (u_op == 0) return vec3(lutOf(c.r).r, lutOf(c.g).g, lutOf(c.b).b);
  if (u_op == 1) return vec3(float(luminosity(c)) >= u_level ? 255.0 : 0.0);
  if (u_op == 2) return lutOf(luminosity(c));
  if (u_op == 3) {
    float r = float(c.r), g = float(c.g), b = float(c.b);
    float mx, md, mn, primary, secondary;
    if (c.r >= c.g && c.r >= c.b) {
      mx = r; primary = u_weights[0];
      if (c.g >= c.b) { md = g; mn = b; secondary = u_weights[1]; } else { md = b; mn = g; secondary = u_weights[5]; }
    } else if (c.g >= c.r && c.g >= c.b) {
      mx = g; primary = u_weights[2];
      if (c.r >= c.b) { md = r; mn = b; secondary = u_weights[1]; } else { md = b; mn = r; secondary = u_weights[3]; }
    } else {
      mx = b; primary = u_weights[4];
      if (c.g >= c.r) { md = g; mn = r; secondary = u_weights[3]; } else { md = r; mn = g; secondary = u_weights[5]; }
    }
    return vec3(clampByte(mn + (mx - md) * primary + (md - mn) * secondary));
  }
  vec3 color = vec3(c) / 255.0;
  vec3 hsl = toHsl(color);
  if (u_op == 4) {
    float hue = hsl.x;
    float saturation = hsl.y;
    float lightness = hsl.z;
    if (u_colorize) {
      hue = u_hsl.x - floor(u_hsl.x);
      saturation = clamp(u_hsl.y, 0.0, 1.0);
    } else {
      hue = hue + u_hsl.x;
      hue -= floor(hue);
      saturation = clamp(saturation * (1.0 + u_hsl.y), 0.0, 1.0);
    }
    lightness = u_hsl.z < 0.0 ? lightness * (1.0 + u_hsl.z) : lightness + (1.0 - lightness) * u_hsl.z;
    return fromHsl(hue, saturation, lightness);
  }
  // Colour Balance.
  float l = hsl.z;
  float a = 0.25;
  float b = 0.333;
  float scale = 0.7;
  float shadow = clamp((l - b) / -a + 0.5, 0.0, 1.0) * scale;
  float mid = clamp((l - b) / a + 0.5, 0.0, 1.0) * clamp((l + b - 1.0) / -a + 0.5, 0.0, 1.0) * scale;
  float high = clamp((l + b - 1.0) / a + 0.5, 0.0, 1.0) * scale;
  vec3 shift = (u_shadows * shadow + u_midtones * mid + u_highlights * high) / 100.0;
  vec3 result = vec3(
    clampByte(clamp(color.r + shift.r, 0.0, 1.0) * 255.0),
    clampByte(clamp(color.g + shift.g, 0.0, 1.0) * 255.0),
    clampByte(clamp(color.b + shift.b, 0.0, 1.0) * 255.0)
  );
  if (u_preserve) {
    vec3 shifted = toHsl(result / 255.0);
    result = fromHsl(shifted.x, shifted.y, l);
  }
  return result;
}

float hardLight(float cb, float cs) { return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0); }

float separable(int id, float cb, float cs) {
  if (id == 1) return cb * cs;
  if (id == 2) return cb + cs - cb * cs;
  if (id == 3) return hardLight(cs, cb);
  if (id == 4) return min(cb, cs);
  if (id == 5) return max(cb, cs);
  if (id == 6) return cb == 0.0 ? 0.0 : cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs));
  if (id == 7) return cb >= 1.0 ? 1.0 : cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs);
  if (id == 8) return hardLight(cb, cs);
  if (id == 9) {
    if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
    float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
    return cb + (2.0 * cs - 1.0) * (d - cb);
  }
  if (id == 10) return abs(cb - cs);
  if (id == 11) return cb + cs - 2.0 * cb * cs;
  return cs;
}

float lum(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}

vec3 blendColors(int id, vec3 cb, vec3 cs) {
  if (id == 12) return setLum(setSat(cs, sat(cb)), lum(cb));
  if (id == 13) return setLum(setSat(cb, sat(cs)), lum(cb));
  if (id == 14) return setLum(cs, lum(cb));
  if (id == 15) return setLum(cb, lum(cs));
  return vec3(separable(id, cb.r, cs.r), separable(id, cb.g, cs.g), separable(id, cb.b, cs.b));
}

void main() {
  ivec2 at = ivec2(gl_FragCoord.xy) + u_offset;
  vec4 backdrop = texelFetch(u_backdrop, at, 0);
  if (backdrop.a <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  ivec3 bytes = ivec3(floor(backdrop.rgb * 255.0 + 0.5));
  vec3 cb = vec3(bytes) / 255.0;
  vec3 cs = adjust(bytes) / 255.0;
  vec3 blended = u_blend == 0 ? cs : blendColors(u_blend, cb, cs);
  float amount = u_strength;
  if (u_masked) amount *= texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0).r;
  vec3 color = clamp(cb + (blended - cb) * amount, 0.0, 1.0);
  // Premultiplied, as the page composes it.
  outColor = vec4(color * backdrop.a, backdrop.a);
}`;

const OPS: Record<string, number> = { luts: 0, threshold: 1, gradientMap: 2, blackWhite: 3, hueSaturation: 4, colorBalance: 5 };

/** Whether the GPU can run this job (the colour jobs adjustment layers make). */
export const gpuRuns = (job: PixelJob): boolean => job.op in OPS;

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
  backdrop: WebGLTexture;
  lut: WebGLTexture;
  mask: WebGLTexture;
  maxSize: number;
}

let engine: Engine | null = null;
/** Set once WebGL2 is known not to work here. */
let unavailable = false;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "The shader did not compile");
  }
  return shader;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const made = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

function start(): Engine | null {
  if (unavailable) return null;
  if (engine && !engine.gl.isContextLost()) return engine;
  engine = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) {
      unavailable = true;
      return null;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "The shader did not link");
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < count; index += 1) {
      const name = gl.getActiveUniform(program, index)!.name.replace(/\[0\]$/, "");
      uniforms.set(name, gl.getUniformLocation(program, name));
    }
    const made: Engine = {
      canvas,
      gl,
      program,
      uniforms,
      backdrop: texture(gl),
      lut: texture(gl),
      mask: texture(gl),
      maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    gl.uniform1i(uniforms.get("u_backdrop")!, 0);
    gl.uniform1i(uniforms.get("u_lut")!, 1);
    gl.uniform1i(uniforms.get("u_mask")!, 2);
    canvas.addEventListener("webglcontextlost", () => {
      if (engine === made) engine = null;
    });
    engine = made;
    return made;
  } catch (error) {
    console.warn("Adjustment layers fall back to the CPU:", error);
    unavailable = true;
    return null;
  }
}

/** The part of a canvas to work on, in its pixels from the top-left corner. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pixels of `source` inside `rect`, adjusted (premultiplied, the size of
 * `rect`), on a canvas to draw back in place; null when the GPU cannot do it.
 * `mask` (optional) is a canvas the size of `rect` whose red says how much
 * applies at each pixel.
 */
export function adjustOnGpu(
  source: HTMLCanvasElement,
  rect: PixelRect,
  job: PixelJob,
  strength: number,
  blend: string,
  mask?: HTMLCanvasElement | null
): HTMLCanvasElement | null {
  const op = OPS[job.op];
  if (op === undefined) return null;
  const state = start();
  if (!state) return null;
  const { gl, canvas, uniforms } = state;
  if (Math.max(source.width, source.height, rect.width, rect.height) > state.maxSize) return null;
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  if (gl.drawingBufferWidth !== rect.width || gl.drawingBufferHeight !== rect.height) return null;

  const uniform = (name: string) => uniforms.get(name) ?? null;
  gl.viewport(0, 0, rect.width, rect.height);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

  // The backdrop, bottom row first, so rows count up as gl_FragCoord does.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.backdrop);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.uniform2i(uniform("u_offset"), rect.x, source.height - rect.y - rect.height);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const table = new Uint8Array(256 * 4);
  if (job.op === "luts" || job.op === "gradientMap") {
    for (let level = 0; level < 256; level += 1) {
      table[level * 4] = job.luts.r[level]!;
      table[level * 4 + 1] = job.luts.g[level]!;
      table[level * 4 + 2] = job.luts.b[level]!;
      table[level * 4 + 3] = 255;
    }
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.lut);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, table);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, state.mask);
  if (mask && mask.width === rect.width && mask.height === rect.height) {
    // Rows from the bottom, as the backdrop's.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
  }
  gl.uniform1i(uniform("u_masked"), mask ? 1 : 0);

  gl.uniform1i(uniform("u_op"), op);
  gl.uniform1i(uniform("u_blend"), blendId(blend));
  gl.uniform1f(uniform("u_strength"), Math.min(1, Math.max(0, strength)));
  if (job.op === "threshold") gl.uniform1f(uniform("u_level"), job.level);
  if (job.op === "blackWhite") {
    const { reds, yellows, greens, cyans, blues, magentas } = job.settings;
    gl.uniform1fv(uniform("u_weights"), [reds, yellows, greens, cyans, blues, magentas].map((weight) => weight / 100));
  }
  if (job.op === "hueSaturation") {
    const { hue, saturation, lightness, colorize } = job.settings;
    gl.uniform3f(uniform("u_hsl"), hue / 360, saturation / 100, lightness / 100);
    gl.uniform1i(uniform("u_colorize"), colorize ? 1 : 0);
  }
  if (job.op === "colorBalance") {
    const { shadows, midtones, highlights, preserveLuminosity } = job.settings;
    gl.uniform3fv(uniform("u_shadows"), shadows);
    gl.uniform3fv(uniform("u_midtones"), midtones);
    gl.uniform3fv(uniform("u_highlights"), highlights);
    gl.uniform1i(uniform("u_preserve"), preserveLuminosity ? 1 : 0);
  }
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}
