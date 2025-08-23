import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input.js';
import { World } from './World.js';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');

// Renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

// Scene + Camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 1.7, 5);

// Controls
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

// Input
const input = new Input();

// World
const world = new World(scene);

// Raycaster for shooting
const raycaster = new THREE.Raycaster();
raycaster.far = 100;

// Player state
const player = {
  velocity: new THREE.Vector3(0, 0, 0),
  speed: 6.0,
  sprintMult: 1.6,
  gravity: 20.0,
  jumpSpeed: 7.0,
  onGround: false,
  radius: 0.6,
  height: 1.7
};

// Score/FPS
let score = 0;
let lastTime = performance.now();
let acc = 0;
let frames = 0;
let fps = 0;

// Pointer lock start
startBtn.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
  overlay.style.display = 'none';
});

// Shooting
window.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) shoot();
});

function shoot() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const intersects = raycaster.intersectObjects(world.targetGroup.children, false);
  if (intersects.length > 0) {
    if (world.handleHit(intersects[0])) {
      score++;
      flashHit();
    }
  }
}

function flashHit() {
  const old = scene.background.clone();
  scene.background.setHex(0x15151c);
  setTimeout(() => scene.background.copy(old), 50);
}

// Movement
const moveDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function updateControls(dt) {
  forward.set(0,0,-1).applyQuaternion(camera.quaternion);
  right.set(1,0,0).applyQuaternion(camera.quaternion);
  forward.y = 0; right.y = 0;
  forward.normalize(); right.normalize();

  moveDir.set(0,0,0);
  if (input.forward) moveDir.add(forward);
  if (input.back) moveDir.sub(forward);
  if (input.right) moveDir.add(right);
  if (input.left) moveDir.sub(right);

  const isMoving = moveDir.lengthSq() > 0.0001;
  if (isMoving) moveDir.normalize();

  const targetSpeed = (input.sprint ? player.speed * player.sprintMult : player.speed);
  const accel = isMoving ? 30 : 20;

  const desiredVX = moveDir.x * targetSpeed;
  const desiredVZ = moveDir.z * targetSpeed;
  player.velocity.x += (desiredVX - player.velocity.x) * Math.min(1, accel * dt);
  player.velocity.z += (desiredVZ - player.velocity.z) * Math.min(1, accel * dt);

  // Gravity/jump
  player.velocity.y -= player.gravity * dt;
  if (input.jump && player.onGround) {
    player.velocity.y = player.jumpSpeed;
    player.onGround = false;
  }

  // Integrate
  const obj = controls.getObject();
  const nextPos = obj.position.clone().addScaledVector(player.velocity, dt);

  // Ground check
  const groundRay = new THREE.Raycaster(
    new THREE.Vector3(nextPos.x, nextPos.y, nextPos.z),
    new THREE.Vector3(0, -1, 0),
    0,
    player.height + 0.2
  );
  const groundHits = groundRay.intersectObjects(scene.children, true).filter(h => h.object.name === 'floor' || h.object.name === 'obstacle');
  const nearGround = groundHits.some(h => h.distance < player.height * 0.52);
  if (nearGround && player.velocity.y <= 0) {
    player.velocity.y = 0;
    player.onGround = true;
    nextPos.y = Math.max(nextPos.y, 1.7);
  } else {
    player.onGround = false;
  }

  // Collisions
  world.resolveCollisions(nextPos, player.radius, player.height);

  obj.position.copy(nextPos);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

// Main loop
function loop() {
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (document.pointerLockElement === renderer.domElement) {
    updateControls(dt);
  }

  world.update(dt);
  renderer.render(scene, camera);

  // FPS
  acc += dt; frames++;
  if (acc >= 0.25) {
    fps = Math.round(frames / acc);
    frames = 0; acc = 0;
  }
  hud.textContent = `Score: ${score} | Targets: ${world.targets.length} | FPS: ${fps}`;

  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);

// Defaults for perf
renderer.shadowMap.enabled = false;
