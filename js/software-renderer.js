import { Vector3, Matrix3 } from '../assets/vendor/three.module.min.js';

const clamp = x => Math.max(0, Math.min(1, x));
const displayChannel = value => {
  const x = Math.max(0, value);
  const mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  return 255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055);
};

/** Depth-tested perspective rasterization; works with either triangle winding. */
export function rasterizeTriangle(pixels, depthBuffer, width, height, points, colors) {
  const [a, b, c] = points;
  if (a[2] <= 0 || b[2] <= 0 || c[2] <= 0) return;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-7) return;
  const inverseArea = 1 / area;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inverseArea;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inverseArea;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const index = y * width + x;
      const inverseDepth = w0 * a[2] + w1 * b[2] + w2 * c[2];
      if (inverseDepth < depthBuffer[index]) continue;
      depthBuffer[index] = inverseDepth;
      const k0 = w0 * a[2] / inverseDepth;
      const k1 = w1 * b[2] / inverseDepth;
      const k2 = w2 * c[2] / inverseDepth;
      const pixel = index * 4;
      for (let channel = 0; channel < 3; channel++) pixels[pixel + channel] = k0 * colors[0][channel] + k1 * colors[1][channel] + k2 * colors[2][channel];
      pixels[pixel + 3] = 255;
    }
  }
}

/** Canvas 2D fallback: the same 3D surface and camera, without a GPU context. */
export class SoftwareRenderer {
  constructor() {
    this.isSoftwareRenderer = true;
    this.domElement = document.createElement('canvas');
    this.context = this.domElement.getContext('2d', { alpha: true });
    if (!this.context) throw new Error('В браузере недоступна отрисовка Canvas.');
    this.pixelRatio = 1;
    this.cache = new WeakMap();
    this.key = new Vector3(-3, 8, 5).normalize();
    this.fill = new Vector3(7, 1, -4).normalize();
  }

  setPixelRatio(ratio) { this.pixelRatio = Math.min(ratio, 1.5); }
  setClearColor() {}

  setSize(width, height) {
    const w = Math.max(1, Math.round(width * this.pixelRatio));
    const h = Math.max(1, Math.round(height * this.pixelRatio));
    if (w === this.domElement.width && h === this.domElement.height && this.image) return;
    this.domElement.width = w;
    this.domElement.height = h;
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
    this.image = this.context.createImageData(w, h);
    this.depth = new Float32Array(w * h);
  }

  project(object, camera) {
    const attribute = object.geometry.attributes.position;
    if (!this.cache.has(object.geometry)) this.cache.set(object.geometry, {
      projected: Array.from({ length: attribute.count }, () => [0, 0, 0]),
      colors: Array.from({ length: attribute.count }, () => [0, 0, 0]),
    });
    const data = this.cache.get(object.geometry);
    const position = new Vector3();
    const view = new Vector3();
    const normal = new Vector3();
    const towardCamera = new Vector3();
    const halfway = new Vector3();
    const normalMatrix = new Matrix3().getNormalMatrix(object.matrixWorld);
    const normalAttribute = object.geometry.attributes.normal;
    const w = this.domElement.width;
    const h = this.domElement.height;
    const scaleX = camera.projectionMatrix.elements[0] * w / 2;
    const scaleY = camera.projectionMatrix.elements[5] * h / 2;
    for (let i = 0; i < attribute.count; i++) {
      position.fromBufferAttribute(attribute, i).applyMatrix4(object.matrixWorld);
      view.copy(position).applyMatrix4(camera.matrixWorldInverse);
      const depth = -view.z;
      const point = data.projected[i];
      point[0] = w / 2 + view.x * scaleX / depth;
      point[1] = h / 2 - view.y * scaleY / depth;
      point[2] = depth >= camera.near && depth <= camera.far ? 1 / depth : 0;
      if (!normalAttribute) continue;
      normal.fromBufferAttribute(normalAttribute, i).applyNormalMatrix(normalMatrix);
      towardCamera.subVectors(camera.position, position).normalize();
      if (normal.dot(towardCamera) < 0) normal.negate();
      const key = Math.max(0, normal.dot(this.key));
      const fill = Math.max(0, normal.dot(this.fill));
      halfway.copy(this.key).add(towardCamera).normalize();
      const highlight = Math.max(0, normal.dot(halfway)) ** (16 + (1 - object.material.roughness) * 42);
      const lighting = 0.25 + 0.78 * key + 0.38 * fill;
      const specular = highlight * (0.18 + object.material.metalness * 0.5);
      const base = object.material.color;
      const color = data.colors[i];
      color[0] = displayChannel(base.r * lighting + specular);
      color[1] = displayChannel(base.g * lighting + specular * 0.95);
      color[2] = displayChannel(base.b * lighting + specular * 0.86);
    }
    return data;
  }

  line(a, b, rgb, opacity, thickness) {
    if (a[2] <= 0 || b[2] <= 0) return;
    const width = this.domElement.width;
    const height = this.domElement.height;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let low = 0;
    let high = 1;
    // Clip the segment to the viewport before walking its pixels.
    for (const [p, q] of [[-dx, a[0]], [dx, width - 1 - a[0]], [-dy, a[1]], [dy, height - 1 - a[1]]]) {
      if (Math.abs(p) < 1e-10) { if (q < 0) return; continue; }
      const r = q / p;
      if (p < 0) low = Math.max(low, r); else high = Math.min(high, r);
    }
    if (low > high) return;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * (high - low)));
    const radius = Math.floor(thickness / 2);
    const pixels = this.image.data;
    for (let i = 0; i <= steps; i++) {
      const t = low + (high - low) * i / steps;
      const x = Math.round(a[0] + dx * t);
      const y = Math.round(a[1] + dy * t);
      const inverseDepth = a[2] + (b[2] - a[2]) * t;
      for (let yy = y - radius; yy <= y + radius; yy++) {
        for (let xx = x - radius; xx <= x + radius; xx++) {
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
          const index = yy * width + xx;
          if (inverseDepth * 1.0015 < this.depth[index]) continue;
          const pixel = index * 4;
          const alpha = pixels[pixel + 3] ? opacity : 1;
          for (let channel = 0; channel < 3; channel++) pixels[pixel + channel] = rgb[channel] * alpha + pixels[pixel + channel] * (1 - alpha);
          pixels[pixel + 3] = 255;
        }
      }
    }
  }

  render(scene, camera) {
    if (!this.image) return;
    this.image.data.fill(0);
    this.depth.fill(0);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const lines = [];
    scene.traverseVisible(object => {
      if (object.isLine) { lines.push(object); return; }
      if (!object.isMesh) return;
      const data = this.project(object, camera);
      const indices = object.geometry.index.array;
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2];
        rasterizeTriangle(this.image.data, this.depth, this.domElement.width, this.domElement.height,
          [data.projected[a], data.projected[b], data.projected[c]], [data.colors[a], data.colors[b], data.colors[c]]);
      }
    });
    for (const object of lines) {
      const { projected } = this.project(object, camera);
      const color = object.material.color.clone().convertLinearToSRGB();
      const rgb = [color.r * 255, color.g * 255, color.b * 255];
      const step = object.isLineSegments ? 2 : 1;
      for (let i = 0; i < projected.length - 1; i += step) this.line(projected[i], projected[i + 1], rgb, object.material.opacity, object.isLineSegments ? 1 : 2 * this.pixelRatio);
    }
    this.context.putImageData(this.image, 0, 0);
  }

  dispose() { this.image = null; this.depth = null; this.cache = new WeakMap(); }
}
