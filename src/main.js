import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input.js';
import { World } from './World.js';
import { Sound } from './Sound.js';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const damageVignette = document.getElementById('damageVignette');
const pauseOverlay = document.getElementById('pauseOverlay');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const startVolume = document.getElementById('startVolume');
const startVolumeVal = document.getElementById('startVolumeVal');
const pauseVolume = document.getElementById('pauseVolume');
const pauseVolumeVal = document.getElementById('pauseVolumeVal');
const protectedBadge = document.getElementById('protectedBadge');

// Renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.physicallyCorrectLights = true;
app.appendChild(renderer.domElement);

// Scene + Camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);
scene.fog = new THREE.FogExp2(0x0e0e12, 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 1.7, 5);

// Controls
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

// Input
const input = new Input();

// World
const world = new World(scene);

// Sound
const sound = new Sound();

// Raycasters
const shootRay = new THREE.Raycaster();
shootRay.far = 100;

const groundRay = new THREE.Raycaster();

// Player state
const player = {
  velocity: new THREE.Vector3(0, 0, 0),
  speed: 6.2,
  sprintMult: 1.6,
  gravity: 20.0,
  jumpSpeed: 7.0,
  onGround: false,
  radius: 0.6,
  height: 1.7, // eye height
  health: 100,
};
let spawnProtectedTime = 2.0;

// Score/FPS
let score = 0;
let lastTime = performance.now();
let acc = 0;
let frames = 0;
let fps = 0;

// Gun: improved simple model with recoil and sway
const gun = new THREE.Group();
let recoilT = 0;
{
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.4, roughness: 0.3 });
  const matAcc  = new THREE.MeshStandardMaterial({ color: 0x8892f6, emissive: 0x3038c2, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.2 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.9), matBody);
  receiver.position.set(0.02, 0.02, 0.35);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 12), matAcc);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.33, 0.03, 0.65);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.4), matBody);
  handguard.position.set(0.14, -0.02, 0.75);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), matAcc);
  sight.position.set(0.02, 0.14, 0.1);

  gun.add(receiver, barrel, handguard, sight);
  gun.position.set(0.35, -0.35, -0.6); // relative to camera
  gun.rotation.set(-0.06, 0.25, 0.0);
  camera.add(gun);
  scene.add(camera);
}

// Muzzle flash (short-lived)
const muzzle = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffe066 })
);
muzzle.visible = false;
muzzle.position.set(0.45, -0.32, 0.05);
camera.add(muzzle);

// Start overlay volume binding
function setAllVolumeFrom(val) {
  const vol01 = (parseInt(val, 10) || 0) / 100;
  sound.setVolume(vol01);
  startVolumeVal.textContent = `${val}%`;
  pauseVolume.value = String(val);
  pauseVolumeVal.textContent = `${val}%`;
}
startVolume.addEventListener('input', (e) => setAllVolumeFrom(e.target.value));
pauseVolume.addEventListener('input', (e) => setAllVolumeFrom(e.target.value));

// UI start
startBtn.addEventListener('click', () => {
  if (!sound.ctx) sound.init();
  sound.resume();
  setAllVolumeFrom(startVolume.value);
  sound.startAmbient();

  renderer.domElement.requestPointerLock();
  overlay.style.display = 'none';
  spawnProtectedTime = 2.0;
  protectedBadge.style.display = 'inline-block';
});

// Pause/resume
let isPaused = false;
function setPaused(p) {
  isPaused = p;
  pauseOverlay.style.display = p ? 'grid' : 'none';
  if (p) {
    document.exitPointerLock?.();
  } else {
    renderer.domElement.requestPointerLock?.();
  }
}
resumeBtn.addEventListener('click', () => setPaused(false));
restartBtn.addEventListener('click', restartGame);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    setPaused(!isPaused);
  }
});

// Shooting (projectile-based)
window.addEventListener('mousedown', (e) => {
  if (isPaused) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) shoot();
});

function shoot() {
  // Spawn a projectile from camera forward
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const origin = camera.position.clone();
  // Lift slightly to simulate barrel
  const start = origin.clone().add(dir.clone().multiplyScalar(0.2));
  world.spawnProjectile(start, dir, 65, 'player', 2.0);

  // Muzzle flash and sound + recoil
  muzzle.visible = true;
  setTimeout(() => (muzzle.visible = false), 50);
  if (!sound.ctx) sound.init();
  sound.playShot();
  recoilT = 0.12;
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

let stepTimer = 0;

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

  // Stable ground check
  groundRay.set(new THREE.Vector3(nextPos.x, nextPos.y, nextPos.z), new THREE.Vector3(0, -1, 0));
  groundRay.near = 0;
  groundRay.far = player.height + 0.5;

  const groundHits = groundRay.intersectObjects(scene.children, true)
    .filter(h => h.object.name === 'floor' || h.object.name === 'obstacle' || h.object.name === 'house_wall' || h.object.name === 'arena_wall' || h.object.name === 'rock')
    .sort((a, b) => a.distance - b.distance);

  const hit = groundHits[0];
  if (hit && hit.distance <= player.height + 0.05 && player.velocity.y <= 0) {
    nextPos.y = hit.point.y + player.height;
    player.velocity.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // Horizontal collisions
  world.resolveCollisions(nextPos, player.radius, player.height);

  // Footsteps
  const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  stepTimer -= dt;
  if (player.onGround && horizSpeed > 2.0 && stepTimer <= 0) {
    if (!sound.ctx) sound.init();
    sound.playStep();
    stepTimer = 0.42 / Math.min(3, horizSpeed);
  }

  obj.position.copy(nextPos);
}

function onPlayerHit(dmg) {
  if (spawnProtectedTime > 0) return;
  player.health = Math.max(0, player.health - dmg);
  // Damage feedback
  damageVignette.style.opacity = '1';
  setTimeout(() => damageVignette.style.opacity = '0', 120);
  if (!sound.ctx) sound.init();
  sound.playHit();
}

function onEnemyShot() {
  if (!sound.ctx) sound.init();
  sound.playEnemyShot();
}

function animateGun(t, dt) {
  // Sway/bob
  const v = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 6);
  const sway = Math.sin(t * 6.0) * 0.004 * v;
  const bob = Math.cos(t * 12.0) * 0.002 * v;

  // Recoil
  if (recoilT > 0) recoilT = Math.max(0, recoilT - dt);
  const r = recoilT > 0 ? (recoilT / 0.12) : 0;
  const kick = r * 0.06;

  gun.position.x = 0.35 + sway;
  gun.position.y = -0.35 + bob - kick*0.5;
  gun.rotation.x = -0.06 - kick;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

function restartGame() {
  // Reset world dynamics
  world.resetDynamic();

  // Reset player
  player.velocity.set(0, 0, 0);
  player.health = 100;
  score = 0;

  // Move to spawn
  const obj = controls.getObject();
  obj.position.set(0, 1.7, 5);

  // Protection
  spawnProtectedTime = 2.0;
  protectedBadge.style.display = 'inline-block';

  setPaused(false);
}

// Main loop
function loop() {
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (!isPaused && document.pointerLockElement === renderer.domElement) {
    updateControls(dt);
  }

  if (!isPaused) {
    const playerPos = controls.getObject().position;
    world.update(dt, playerPos, (dmg) => onPlayerHit(dmg), () => onEnemyShot(), spawnProtectedTime <= 0);
    animateGun(now * 0.001, dt);
  }

  // Spawn protection timer
  if (spawnProtectedTime > 0) {
    spawnProtectedTime = Math.max(0, spawnProtectedTime - dt);
    if (spawnProtectedTime === 0) protectedBadge.style.display = 'none';
  }

  renderer.render(scene, camera);

  // FPS + HUD
  acc += dt; frames++;
  if (acc >= 0.25) {
    fps = Math.round(frames / acc);
    frames = 0; acc = 0;
  }
  const targetsLeft = world.targets.length;
  const enemiesLeft = world.enemies.length;
  hud.textContent = `Health: ${player.health} | Score: ${score} | Targets: ${targetsLeft} | Enemies: ${enemiesLeft} | FPS: ${fps}`;

  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);

// Defaults for perf
renderer.shadowMap.enabled = false;
