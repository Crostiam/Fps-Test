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

// Raycasters
const shootRay = new THREE.Raycaster();
shootRay.far = 100;

const groundRay = new THREE.Raycaster();

// Player state
const player = {
  velocity: new THREE.Vector3(0, 0, 0),
  speed: 6.0,
  sprintMult: 1.6,
  gravity: 20.0,
  jumpSpeed: 7.0,
  onGround: false,
  radius: 0.6,
  height: 1.7 // eye height
};

// Score/FPS
let score = 0;
let lastTime = performance.now();
let acc = 0;
let frames = 0;
let fps = 0;

// Simple gun attached to camera
const gun = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x303642, metalness: 0.2, roughness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x5865f2, emissive: 0x1a1f6a, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.0), bodyMat);
  body.position.set(0, 0, 0.3);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.5), accentMat);
  barrel.position.set(0.17, 0, 0.85);
  gun.add(body, barrel);
  gun.position.set(0.35, -0.35, -0.6); // relative to camera
  gun.rotation.set(-0.05, 0.25, 0.0);
  camera.add(gun);
  scene.add(camera);
}

// Muzzle flash (short-lived)
const muzzle = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffe066 })
);
muzzle.visible = false;
muzzle.position.set(0.17, -0.35, -0.05);
camera.add(muzzle);

// UI start
startBtn.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
  overlay.style.display = 'none';
});

// Shooting
window.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) shoot();
});

function getShootables() {
  return [...world.targetGroup.children, ...world.enemyGroup.children];
}

function shoot() {
  shootRay.setFromCamera({ x: 0, y: 0 }, camera);
  const intersects = shootRay.intersectObjects(getShootables(), true);
  // Muzzle flash
  muzzle.visible = true;
  setTimeout(() => (muzzle.visible = false), 50);

  if (intersects.length > 0) {
    const result = world.handleHit(intersects[0]);
    if (result.score) score += result.score;
    flashHit();
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
  // Camera basis
  forward.set(0,0,-1).applyQuaternion(camera.quaternion);
  right.set(1,0,0).applyQuaternion(camera.quaternion);
  forward.y = 0; right.y = 0;
  forward.normalize(); right.normalize();

  // Input to movement vector
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

  const obj = controls.getObject();
  const nextPos = obj.position.clone().addScaledVector(player.velocity, dt);

  // Stable ground check: cast down from the camera (eye) to find ground within eye-height + epsilon
  groundRay.set(new THREE.Vector3(nextPos.x, nextPos.y, nextPos.z), new THREE.Vector3(0, -1, 0));
  groundRay.near = 0;
  groundRay.far = player.height + 0.5;

  // Only collide with floor-like geometry
  const groundHits = groundRay.intersectObjects(scene.children, true)
    .filter(h => h.object.name === 'floor' || h.object.name === 'obstacle' || h.object.name === 'house')
    .sort((a, b) => a.distance - b.distance);

  const hit = groundHits[0];
  if (hit && hit.distance <= player.height + 0.05 && player.velocity.y <= 0) {
    // Snap so eye is exactly player.height above the ground hit point
    nextPos.y = hit.point.y + player.height;
    player.velocity.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // Horizontal collisions
  world.resolveCollisions(nextPos, player.radius, player.height);

  obj.position.copy(nextPos);
}

function animateGun(t, dt) {
  // Minimal sway/bob
  const sway = Math.sin(t * 6.0) * 0.004 * Math.min(1, player.velocity.length() / 6);
  const bob = Math.cos(t * 12.0) * 0.002 * Math.min(1, player.velocity.length() / 6);
  gun.position.x = 0.35 + sway;
  gun.position.y = -0.35 + bob;
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

  // World update with player position so enemies can chase you
  world.update(dt, controls.getObject().position);

  animateGun(now * 0.001, dt);

  renderer.render(scene, camera);

  // FPS
  acc += dt; frames++;
  if (acc >= 0.25) {
    fps = Math.round(frames / acc);
    frames = 0; acc = 0;
  }
  const targetsLeft = world.targets.length;
  const enemiesLeft = world.enemies.length;
  hud.textContent = `Score: ${score} | Targets: ${targetsLeft} | Enemies: ${enemiesLeft} | FPS: ${fps}`;

  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);

// Defaults for perf
renderer.shadowMap.enabled = false
