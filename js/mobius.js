/**
 * Standard embedded Möbius strip. u ∈ [0, 2π], v ∈ [-width/2, width/2].
 * The seam identifies (2π, v) with (0, -v), including a flipped normal.
 * Y is the vertical axis; swapping the conventional Y/Z is a rigid reflection.
 */
export const TAU = Math.PI * 2;
export const DEFAULT_RADIUS = 2.6;
export const DEFAULT_WIDTH = 1.8;

export function surfacePoint(u, v, radius = DEFAULT_RADIUS) {
  const r = radius + v * Math.cos(u / 2);
  return [r * Math.cos(u), v * Math.sin(u / 2), r * Math.sin(u)];
}

// Analytic partial derivatives avoid numerical differences at the twisted seam.
export function surfaceNormal(u, v, radius = DEFAULT_RADIUS) {
  const c = Math.cos(u);
  const s = Math.sin(u);
  const ch = Math.cos(u / 2);
  const sh = Math.sin(u / 2);
  const r = radius + v * ch;
  const dr = -0.5 * v * sh;
  const du = [dr * c - r * s, 0.5 * v * ch, dr * s + r * c];
  const dv = [ch * c, sh, ch * s];
  const n = [
    du[1] * dv[2] - du[2] * dv[1],
    du[2] * dv[0] - du[0] * dv[2],
    du[0] * dv[1] - du[1] * dv[0],
  ];
  const length = Math.hypot(...n);
  return n.map(value => value / length);
}

/**
 * The rendering chart intentionally duplicates the seam: a nonorientable
 * surface cannot carry a continuous signed normal or a global front/back.
 * End positions are copied exactly from reversed start vertices (no crack);
 * analytic normals are reversed. Double-sided lighting is required.
 */
export function createSurfaceData({
  radius = DEFAULT_RADIUS,
  width = DEFAULT_WIDTH,
  lengthSegments = 256,
  widthSegments = 32,
} = {}) {
  if (!Number.isFinite(radius) || !Number.isFinite(width) || radius <= 0 || width <= 0 || width >= 2 * radius) {
    throw new RangeError('Require radius > 0 and 0 < width < 2 * radius.');
  }
  if (!Number.isInteger(lengthSegments) || !Number.isInteger(widthSegments) || lengthSegments < 8 || widthSegments < 2) {
    throw new RangeError('Require integer lengthSegments >= 8 and widthSegments >= 2.');
  }
  const stride = widthSegments + 1;
  const count = (lengthSegments + 1) * stride;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const indices = new (count > 65535 ? Uint32Array : Uint16Array)(lengthSegments * widthSegments * 6);

  for (let i = 0; i <= lengthSegments; i++) {
    const u = (i / lengthSegments) * TAU;
    for (let j = 0; j <= widthSegments; j++) {
      const index = (i * stride + j) * 3;
      if (i === lengthSegments) {
        const reversed = (widthSegments - j) * 3;
        for (let axis = 0; axis < 3; axis++) {
          positions[index + axis] = positions[reversed + axis];
          normals[index + axis] = -normals[reversed + axis];
        }
      } else {
        const v = (j / widthSegments - 0.5) * width;
        positions.set(surfacePoint(u, v, radius), index);
        normals.set(surfaceNormal(u, v, radius), index);
      }
    }
  }

  let cursor = 0;
  for (let i = 0; i < lengthSegments; i++) {
    for (let j = 0; j < widthSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = b + 1;
      const d = a + 1;
      indices.set([a, b, d, b, c, d], cursor);
      cursor += 6;
    }
  }
  return { positions, normals, indices, lengthSegments, widthSegments, radius, width };
}

// Both apparent edges form ONE continuous curve, closed only after 4π.
export function sampleBoundary(radius = DEFAULT_RADIUS, width = DEFAULT_WIDTH, segments = 768) {
  const points = new Float32Array((segments + 1) * 3);
  for (let i = 0; i < segments; i++) {
    points.set(surfacePoint((i / segments) * TAU * 2, width / 2, radius), i * 3);
  }
  points.set(points.subarray(0, 3), segments * 3);
  return points;
}

// Sampling coordinate curves directly avoids exposing triangle diagonals.
export function sampleGrid(radius = DEFAULT_RADIUS, width = DEFAULT_WIDTH) {
  const lines = [];
  const along = 256;
  for (const fraction of [-0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375]) {
    for (let i = 0; i < along; i++) {
      lines.push(...surfacePoint((i / along) * TAU, width * fraction, radius));
      lines.push(...surfacePoint(((i + 1) / along) * TAU, width * fraction, radius));
    }
  }
  for (let i = 0; i < 64; i++) {
    const u = (i / 64) * TAU;
    lines.push(...surfacePoint(u, -width / 2, radius), ...surfacePoint(u, width / 2, radius));
  }
  return new Float32Array(lines);
}
