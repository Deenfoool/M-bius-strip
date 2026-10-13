import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceData, surfacePoint, surfaceNormal, sampleBoundary, DEFAULT_RADIUS, TAU } from '../js/mobius.js';

const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const at = (array, index) => Array.from(array.subarray(index * 3, index * 3 + 3));

function stitchedTopology(data) {
  const { lengthSegments: n, widthSegments: m, indices } = data;
  const stride = m + 1;
  const canonical = index => index >= n * stride ? m - (index - n * stride) : index;
  const edges = new Map();
  const vertices = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const face = i / 3;
    const triangle = [indices[i], indices[i + 1], indices[i + 2]].map(canonical);
    for (let j = 0; j < 3; j++) {
      const a = triangle[j];
      const b = triangle[(j + 1) % 3];
      vertices.add(a);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ face, direction: a < b ? 1 : -1, a, b });
    }
  }
  return { vertices, edges, faceCount: indices.length / 3 };
}

for (const width of [0.7, 1.8, 2.8]) {
  test(`Width ${width}: seamless half-twist, valid winding, unit normals`, () => {
    const data = createSurfaceData({ width });
    const { positions, normals, indices, lengthSegments: n, widthSegments: m } = data;
    const stride = m + 1;
    for (let j = 0; j <= m; j++) {
      const start = at(positions, m - j);
      const end = at(positions, n * stride + j);
      assert.deepEqual(end, start, 'The seam must be bit-for-bit coincident.');
      const a = at(normals, m - j);
      const b = at(normals, n * stride + j);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] + b[k]) < 1e-7, 'Seam normals must reverse.');
    }
    assert.ok(positions.every(Number.isFinite));
    assert.ok(normals.every(Number.isFinite));
    for (let i = 0; i < normals.length / 3; i++) assert.ok(Math.abs(Math.hypot(...at(normals, i)) - 1) < 1e-6);
    for (let i = 0; i < indices.length; i += 3) {
      const a = at(positions, indices[i]);
      const b = at(positions, indices[i + 1]);
      const c = at(positions, indices[i + 2]);
      const area = cross(subtract(b, a), subtract(c, a));
      assert.ok(Math.hypot(...area) > 1e-8, 'No degenerate triangles.');
      assert.ok(dot(area, at(normals, indices[i])) > 0, 'Triangle winding must match the analytic normal.');
    }
  });
}

test('The stitched mesh has one boundary loop and Euler characteristic 0', () => {
  const data = createSurfaceData({ lengthSegments: 48, widthSegments: 8 });
  const { vertices, edges, faceCount } = stitchedTopology(data);
  assert.equal(vertices.size - edges.size + faceCount, 0);
  const boundary = new Map();
  for (const uses of edges.values()) {
    assert.ok(uses.length === 1 || uses.length === 2, 'Manifold edge incidence.');
    if (uses.length !== 1) continue;
    const { a, b } = uses[0];
    if (!boundary.has(a)) boundary.set(a, []);
    if (!boundary.has(b)) boundary.set(b, []);
    boundary.get(a).push(b);
    boundary.get(b).push(a);
  }
  assert.equal(boundary.size, data.lengthSegments * 2);
  for (const neighbors of boundary.values()) assert.equal(neighbors.length, 2);
  const start = boundary.keys().next().value;
  const visited = new Set();
  const queue = [start];
  while (queue.length) {
    const vertex = queue.pop();
    if (visited.has(vertex)) continue;
    visited.add(vertex);
    queue.push(...boundary.get(vertex));
  }
  assert.equal(visited.size, boundary.size, 'Every boundary vertex belongs to the same loop.');
});

test('The stitched mesh is connected and cannot be consistently oriented', () => {
  const { edges, faceCount } = stitchedTopology(createSurfaceData({ lengthSegments: 48, widthSegments: 8 }));
  const adjacency = Array.from({ length: faceCount }, () => []);
  for (const uses of edges.values()) {
    if (uses.length !== 2) continue;
    const [a, b] = uses;
    const sign = -a.direction * b.direction;
    adjacency[a.face].push({ face: b.face, sign });
    adjacency[b.face].push({ face: a.face, sign });
  }
  const orientation = new Map([[0, 1]]);
  const queue = [0];
  let contradiction = false;
  while (queue.length) {
    const face = queue.pop();
    for (const next of adjacency[face]) {
      const sign = orientation.get(face) * next.sign;
      if (!orientation.has(next.face)) { orientation.set(next.face, sign); queue.push(next.face); }
      else if (orientation.get(next.face) !== sign) contradiction = true;
    }
  }
  assert.equal(orientation.size, faceCount, 'A single connected surface.');
  assert.equal(contradiction, true, 'A half-twisted strip must be nonorientable.');
});

test('Analytic normals agree with differential geometry away from and across the seam', () => {
  const h = 1e-5;
  for (const u of [0, 0.15, Math.PI, TAU - 0.001, TAU, 3 * Math.PI, 2 * TAU]) {
    for (const v of [-0.8, 0, 0.8]) {
      const du = subtract(surfacePoint(u + h, v), surfacePoint(u - h, v));
      const dv = subtract(surfacePoint(u, v + h), surfacePoint(u, v - h));
      const product = cross(du, dv);
      const normalized = product.map(value => value / Math.hypot(...product));
      assert.ok(dot(normalized, surfaceNormal(u, v)) > 0.9999999);
    }
  }
});

test('The highlighted edge closes after 4π and passes through both chart edges', () => {
  const width = 1.8;
  const points = sampleBoundary(DEFAULT_RADIUS, width, 768);
  assert.deepEqual(at(points, 0), at(points, 768));
  const halfway = at(points, 384);
  const opposite = surfacePoint(0, -width / 2);
  assert.ok(Math.hypot(...subtract(halfway, opposite)) < 1e-6);
  assert.ok(Math.hypot(...subtract(at(points, 0), halfway)) > width * 0.99);
});

test('A trip around the center returns to its point with reversed surface normal', () => {
  assert.ok(Math.hypot(...subtract(surfacePoint(0, 0), surfacePoint(TAU, 0))) < 1e-12);
  assert.ok(dot(surfaceNormal(0, 0), surfaceNormal(TAU, 0)) < -0.9999999);
  assert.ok(dot(surfaceNormal(0, 0), surfaceNormal(2 * TAU, 0)) > 0.9999999);
});
