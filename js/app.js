import * as THREE from '../assets/vendor/three.module.min.js';
import { TrackballControls } from '../assets/vendor/TrackballControls.js';
import { DEFAULT_RADIUS, createSurfaceData, sampleBoundary, sampleGrid } from './mobius.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const announcement = $('announcement');
const palette = {
  copper: { color: '#cd895e', name: 'Медь', metalness: 0.68, roughness: 0.29 },
  ocean: { color: '#60b1bd', name: 'Океан', metalness: 0.5, roughness: 0.26 },
  pearl: { color: '#e0e0d0', name: 'Фарфор', metalness: 0.12, roughness: 0.32 },
};

function showError(message) {
  $('loading').hidden = true;
  $('render-error').hidden = false;
  $('error-message').textContent = message;
  viewport.querySelector('canvas')?.setAttribute('hidden', '');
  for (const element of document.querySelectorAll('.sidebar button, .sidebar input, .stage-tools button')) {
    element.disabled = true;
  }
}

$('reload').addEventListener('click', () => location.reload());
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    announcement.textContent = 'В этом браузере полноэкранный режим недоступен.';
  }
});
if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Выйти из полноэкранного режима' : 'На весь экран';
  $('fullscreen').setAttribute('aria-label', label);
  $('fullscreen').title = label;
});

try {
  initialize();
} catch (error) {
  console.error('Möbius viewer initialization failed:', error);
  showError(`Не удалось запустить 3D. ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
}

function initialize() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  viewport.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.04, 100);
  const ribbon = new THREE.Group();
  scene.add(ribbon);

  // A local studio environment, generated once. No textures or network calls.
  const studio = new THREE.Scene();
  studio.background = new THREE.Color('#647473');
  const panels = [
    { position: [-5, 8, 2], size: [10, 5], color: '#ffe4ce', intensity: 2.5 },
    { position: [6, 2, 4], size: [4, 8], color: '#e8ffff', intensity: 2.2 },
    { position: [0, 2, -8], size: [8, 6], color: '#b9dce3', intensity: 1.9 },
  ];
  for (const panel of panels) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(...panel.size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(panel.color).multiplyScalar(panel.intensity), side: THREE.DoubleSide }),
    );
    plane.position.set(...panel.position);
    plane.lookAt(0, 0, 0);
    studio.add(plane);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.08);
  scene.environment = environment.texture;
  studio.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xe3f2ee, 0x4b3327, 1.3));
  const key = new THREE.DirectionalLight(0xffe5c8, 2.8);
  key.position.set(-3, 8, 5);
  const fill = new THREE.DirectionalLight(0xb8e5ec, 1.6);
  fill.position.set(7, 1, -4);
  scene.add(key, fill);

  const material = new THREE.MeshStandardMaterial({
    color: palette.copper.color,
    metalness: palette.copper.metalness,
    roughness: palette.copper.roughness,
    side: THREE.DoubleSide,
    // Push only the filled surface back slightly; preserve exact line positions.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const boundaryMaterial = new THREE.LineBasicMaterial({ color: 0xf4be80 });
  const edge = new THREE.Line(new THREE.BufferGeometry(), boundaryMaterial);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf1e1c7, transparent: true, opacity: 0.4 }));
  ribbon.add(surface, grid, edge);
  edge.visible = false;
  grid.visible = false;

  function rebuild() {
    const width = Number($('width').value);
    const data = createSurfaceData({ width });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();
    surface.geometry.dispose();
    surface.geometry = geometry;
    edge.geometry.dispose();
    edge.geometry = new THREE.BufferGeometry();
    edge.geometry.setAttribute('position', new THREE.BufferAttribute(sampleBoundary(DEFAULT_RADIUS, width), 3));
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry();
    grid.geometry.setAttribute('position', new THREE.BufferAttribute(sampleGrid(DEFAULT_RADIUS, width), 3));
    $('width-value').value = width.toFixed(2);
    $('width').setAttribute('aria-valuetext', `${width.toFixed(2)} условных единиц`);
  }
  rebuild();

  const controls = new TrackballControls(camera, viewport);
  controls.rotateSpeed = 3.1;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.55;
  controls.dynamicDampingFactor = 0.18;
  controls.minDistance = 1.3;
  controls.maxDistance = 45;
  // Keyboard handling below is scoped to the focused viewport.
  controls.keys = [];

  let pristine = true;
  let autoRotate = false;
  let interacting = false;
  let requestedFrame = 0;
  let previousTime = 0;
  let lastActivity = 0;
  let zoomText = '';
  let contextLost = false;
  let widthFrame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  controls.staticMoving = reducedMotion.matches;

  function updateHome() {
    const direction = new THREE.Vector3(6, 6.8, 9).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * camera.aspect;
    const positions = surface.geometry.attributes.position;
    const point = new THREE.Vector3();
    let distance = 0;
    // Fit both dimensions, including portrait phones. Leave room for the toolbar.
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      const depth = point.dot(direction);
      distance = Math.max(distance, depth + Math.abs(point.dot(right)) / (tanX * 0.78), depth + Math.abs(point.dot(up)) / (tanY * 0.82));
    }
    controls.position0.copy(direction.multiplyScalar(distance));
    controls.up0.set(0, 1, 0);
    controls.target0.set(0, 0, 0);
    controls.zoom0 = 1;
  }

  function wake() {
    lastActivity = performance.now();
    if (!requestedFrame && !document.hidden && !contextLost) requestedFrame = requestAnimationFrame(render);
  }

  function render(time) {
    requestedFrame = 0;
    if (document.hidden || contextLost) { previousTime = 0; return; }
    const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    if (autoRotate && !interacting) ribbon.rotation.y += delta * 0.17;
    controls.update();
    const percent = Math.round(controls.position0.length() / camera.position.distanceTo(controls.target) * 100);
    const currentZoom = `${percent}%`;
    if (currentZoom !== zoomText) { $('zoom-level').textContent = currentZoom; zoomText = currentZoom; }
    renderer.render(scene, camera);
    // Settle inertia, then stop rendering an unchanged scene to save GPU power.
    if (autoRotate || interacting || time - lastActivity < (controls.staticMoving ? 100 : 1800)) {
      requestedFrame = requestAnimationFrame(render);
    } else previousTime = 0;
  }

  function handleResize() {
    const { width, height } = viewport.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    controls.handleResize();
    updateHome();
    if (pristine) controls.reset();
    wake();
  }
  const resize = new ResizeObserver(handleResize);
  handleResize();
  resize.observe(viewport);

  controls.addEventListener('start', () => { pristine = false; interacting = true; viewport.classList.add('dragging'); wake(); });
  controls.addEventListener('end', () => { interacting = false; viewport.classList.remove('dragging'); wake(); });
  viewport.addEventListener('pointerdown', () => viewport.focus({ preventScroll: true }));
  viewport.addEventListener('pointercancel', () => { interacting = false; viewport.classList.remove('dragging'); wake(); });
  // Start/end events cover drag gestures; wheel needs its own wake-up.
  viewport.addEventListener('wheel', () => { pristine = false; wake(); }, { passive: true });

  function setAuto(enabled) {
    autoRotate = enabled;
    $('auto-rotate').checked = enabled;
    wake();
  }
  function resetCamera() {
    setAuto(false);
    ribbon.rotation.set(0, 0, 0);
    pristine = true;
    updateHome();
    controls.reset();
    wake();
    announcement.textContent = 'Исходный ракурс восстановлен.';
  }
  function zoom(factor) {
    pristine = false;
    const eye = new THREE.Vector3().subVectors(camera.position, controls.target);
    const distance = THREE.MathUtils.clamp(eye.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(eye.setLength(distance));
    controls.update();
    wake();
  }
  $('zoom-in').addEventListener('click', () => zoom(0.82));
  $('zoom-out').addEventListener('click', () => zoom(1 / 0.82));
  $('reset-camera').addEventListener('click', resetCamera);
  $('auto-rotate').addEventListener('change', event => setAuto(event.target.checked));
  $('boundary').addEventListener('change', event => { edge.visible = event.target.checked; wake(); });

  function setGrid(enabled) {
    grid.visible = enabled;
    $('view-surface').setAttribute('aria-pressed', String(!enabled));
    $('view-grid').setAttribute('aria-pressed', String(enabled));
    material.roughness = enabled ? 0.48 : palette[document.querySelector('.swatch[aria-pressed="true"]').dataset.color].roughness;
    wake();
  }
  $('view-surface').addEventListener('click', () => setGrid(false));
  $('view-grid').addEventListener('click', () => setGrid(true));
  for (const button of document.querySelectorAll('.swatch')) {
    button.addEventListener('click', () => {
      const choice = palette[button.dataset.color];
      material.color.set(choice.color);
      material.metalness = choice.metalness;
      material.roughness = grid.visible ? 0.48 : choice.roughness;
      grid.material.color.set(button.dataset.color === 'pearl' ? 0x586566 : 0xf1e1c7);
      for (const swatch of document.querySelectorAll('.swatch')) swatch.setAttribute('aria-pressed', String(swatch === button));
      $('material-name').textContent = choice.name;
      wake();
    });
  }
  $('width').addEventListener('input', () => {
    // Coalesce rapid slider events into one geometry update per display frame.
    if (!widthFrame) widthFrame = requestAnimationFrame(() => {
      widthFrame = 0;
      rebuild();
      updateHome();
      if (pristine) controls.reset();
      wake();
    });
  });

  viewport.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = event.code;
    if (action === 'KeyR') { event.preventDefault(); resetCamera(); return; }
    if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(action)) {
      event.preventDefault(); zoom(['Equal', 'NumpadAdd'].includes(action) ? 0.9 : 1 / 0.9); return;
    }
    if (action === 'Space') { event.preventDefault(); setAuto(!autoRotate); return; }
    const eye = new THREE.Vector3().subVectors(camera.position, controls.target);
    const up = camera.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(up, eye).normalize();
    let axis;
    let angle = 0.085;
    switch (action) {
      case 'ArrowLeft': axis = up; break;
      case 'ArrowRight': axis = up; angle = -angle; break;
      case 'ArrowUp': axis = right; break;
      case 'ArrowDown': axis = right; angle = -angle; break;
      case 'KeyQ': axis = eye.clone().normalize(); break;
      case 'KeyE': axis = eye.clone().normalize(); angle = -angle; break;
      default: return;
    }
    event.preventDefault();
    pristine = false;
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    eye.applyQuaternion(rotation);
    camera.up.applyQuaternion(rotation);
    camera.position.copy(controls.target).add(eye);
    controls.update();
    wake();
  });

  reducedMotion.addEventListener('change', event => { controls.staticMoving = event.matches; if (event.matches) setAuto(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(requestedFrame); requestedFrame = 0; previousTime = 0;
    } else wake();
  });
  window.addEventListener('blur', () => { interacting = false; viewport.classList.remove('dragging'); });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(requestedFrame);
    showError('Браузер прервал 3D-отрисовку. Нажмите «Попробовать ещё раз», чтобы восстановить модель.');
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    resize.disconnect();
    cancelAnimationFrame(requestedFrame);
    cancelAnimationFrame(widthFrame);
    controls.dispose();
    environment.dispose();
    for (const object of [surface, edge, grid]) { object.geometry.dispose(); object.material.dispose(); }
    renderer.dispose();
  });

  // Dimensions and home camera are initialized before requesting the first frame.
  $('loading').hidden = true;
  wake();
}
