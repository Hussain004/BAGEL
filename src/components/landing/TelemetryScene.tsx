import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const POINT_COUNT = 1700;
const DUST_COUNT = 260;

function createPointCloud(): THREE.Points {
  const positions = new Float32Array(POINT_COUNT * 3);
  const colors = new Float32Array(POINT_COUNT * 3);
  const blue = new THREE.Color('#33b5ff');
  const green = new THREE.Color('#54f6b0');
  const color = new THREE.Color();

  for (let i = 0; i < POINT_COUNT; i += 1) {
    const arm = i % 4;
    const distance = Math.pow(Math.random(), 0.62) * 8.5;
    const angle = distance * 0.72 + arm * (Math.PI / 2) + (Math.random() - 0.5) * 0.68;
    const elevation = (Math.random() - 0.5) * (0.7 + distance * 0.2);

    positions[i * 3] = Math.cos(angle) * distance;
    positions[i * 3 + 1] = elevation + Math.sin(distance * 0.8) * 0.22;
    positions[i * 3 + 2] = Math.sin(angle) * distance;

    color.copy(blue).lerp(green, Math.min(1, distance / 8.5));
    const brightness = 0.68 + Math.random() * 0.32;
    colors[i * 3] = color.r * brightness;
    colors[i * 3 + 1] = color.g * brightness;
    colors[i * 3 + 2] = color.b * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function createNavigationPath(): THREE.Line {
  const anchors = [
    new THREE.Vector3(-5.8, -0.9, 2.8),
    new THREE.Vector3(-3.2, 0.2, 1.1),
    new THREE.Vector3(-1.2, -0.15, -0.8),
    new THREE.Vector3(1.4, 0.5, -1.8),
    new THREE.Vector3(3.9, -0.2, -0.2),
    new THREE.Vector3(6.4, 0.7, -2.4),
  ];
  const curve = new THREE.CatmullRomCurve3(anchors);
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120));
  const material = new THREE.LineBasicMaterial({
    color: '#54f6b0',
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Line(geometry, material);
}

function createDust(): THREE.Points {
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT * 3; i += 1) positions[i] = (Math.random() - 0.5) * 18;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: '#8fb8d8',
    size: 0.018,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

export function TelemetryScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    } catch {
      canvas.dataset.webgl = 'unavailable';
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(0, 4.8, 11.5);
    camera.lookAt(0, 0, 0);

    const world = new THREE.Group();
    world.rotation.x = -0.2;
    world.rotation.z = -0.08;
    scene.add(world);

    const pointCloud = createPointCloud();
    const navigationPath = createNavigationPath();
    const dust = createDust();
    world.add(pointCloud, navigationPath);
    scene.add(dust);

    const grid = new THREE.GridHelper(24, 32, '#225374', '#132a3c');
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.2;
    }
    grid.position.y = -1.8;
    scene.add(grid);

    const pointer = new THREE.Vector2();
    const smoothPointer = new THREE.Vector2();
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = reducedMotionQuery.matches;
    let animationFrame = 0;
    let previousTime = 0;
    let visible = !document.hidden;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };

    const render = (time = 0) => {
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      smoothPointer.lerp(pointer, reducedMotion ? 0.35 : 0.055);
      camera.position.x = smoothPointer.x * 0.9;
      camera.position.y = 4.8 + smoothPointer.y * 0.5;
      camera.lookAt(smoothPointer.x * 0.4, smoothPointer.y * 0.2, 0);
      if (!reducedMotion) {
        world.rotation.y += delta * 0.045;
        pointCloud.rotation.y -= delta * 0.028;
        dust.rotation.y += delta * 0.008;
      }
      renderer.render(scene, camera);
      if (visible && !reducedMotion) animationFrame = requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
      if (reducedMotion) render();
    };
    const onVisibilityChange = () => {
      visible = !document.hidden;
      cancelAnimationFrame(animationFrame);
      if (visible && !reducedMotion) {
        previousTime = performance.now();
        animationFrame = requestAnimationFrame(render);
      }
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      cancelAnimationFrame(animationFrame);
      if (reducedMotion) render();
      else animationFrame = requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotionQuery.addEventListener('change', onMotionChange);
    resize();
    if (reducedMotion) render();
    else animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotionQuery.removeEventListener('change', onMotionChange);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="telemetry-scene" aria-hidden="true" />;
}
