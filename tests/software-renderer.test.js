import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeTriangle } from '../js/software-renderer.js';

test('Near triangles occlude far triangles independently of draw order and winding', () => {
  const render = reverse => {
    const pixels = new Uint8ClampedArray(16 * 16 * 4);
    const depth = new Float32Array(16 * 16);
    const near = [[1, 1, 0.5], [14, 1, 0.5], [1, 14, 0.5]];
    const far = [[1, 14, 0.25], [14, 1, 0.25], [1, 1, 0.25]];
    const red = [[255, 0, 0], [255, 0, 0], [255, 0, 0]];
    const blue = [[0, 0, 255], [0, 0, 255], [0, 0, 255]];
    const drawNear = () => rasterizeTriangle(pixels, depth, 16, 16, near, red);
    const drawFar = () => rasterizeTriangle(pixels, depth, 16, 16, far, blue);
    if (reverse) { drawNear(); drawFar(); } else { drawFar(); drawNear(); }
    return pixels;
  };
  const image = render(false);
  assert.deepEqual(image, render(true));
  assert.deepEqual(Array.from(image.subarray((4 * 16 + 4) * 4, (4 * 16 + 4) * 4 + 4)), [255, 0, 0, 255]);
});

test('The rasterizer clips to the image and leaves the transparent background intact', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  const depth = new Float32Array(8 * 8);
  const color = [[80, 150, 220], [80, 150, 220], [80, 150, 220]];
  rasterizeTriangle(pixels, depth, 8, 8, [[-10, -10, 1], [7, 0, 1], [0, 7, 1]], color);
  assert.equal(pixels[3], 255);
  assert.equal(pixels[(7 * 8 + 7) * 4 + 3], 0);
  assert.ok(depth.every(Number.isFinite));
});

test('Triangles behind the camera do not produce invalid pixels', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  const depth = new Float32Array(8 * 8);
  rasterizeTriangle(pixels, depth, 8, 8, [[0, 0, 0], [7, 0, 1], [0, 7, 1]], [[255, 255, 255], [255, 255, 255], [255, 255, 255]]);
  assert.equal(pixels.some(Boolean), false);
});
