import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input.js';
import { World } from './World.js';
import { Sound } from './Sound.js';
import { RoomManager } from './RoomManager.js';
import { Assets } from './Assets.js';
import { ASSET_MANIFEST } from './assets-manifest.js';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const home = document.getElementById('home');
const pauseOverlay = document.getElementById('pauseOverlay');
const deathOverlay = document.getElementById('death');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const toHomeBtn = document.getElementById('toHomeBtn');
const startAgainBtn = document.getElementById('startAgainBtn');
const startRunBtn = document.getElementById('startRunBtn');
const damageVignette = document.getElementById('damageVignette');
const protectedBadge = document.getElementById('protectedBadge');
const hint = document.getElementById('hint');

const volumeSlider = document.getElementById('volumeSlider');
const volumeSliderPause = document.getElementById('volumeSliderPause');

const slotPistol = document.getElementById('slotPistol');
const slotRifle = document.getElementById('slotRifle');
const slotShotgun = document.getElementById('slotShotgun');
const slotSMG = document.getElementById('slotSMG');
const ammoPistol = document.getElementById('ammoPistol');
const ammoRifle = document.getElementById('ammoRifle');
const ammoShotgun = document.getElementById('ammoShotgun');
const ammoSMG = document.getElementById('ammoSMG');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.physicallyCorrectLights = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);
scene.fog = new THREE.FogExp2(0x0e0e12, 0.015);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 1.7, 0);

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const input = new Input();
let interactPressed = false;
let mouseDownLeft = false;
window.addEventListener('keydown', (e) => { if (e.code === 'KeyE') interactPressed = true; });
window.addEventListener('mousedown', (e) => {
  if (state !== State.RUN || isPaused) return;
  if (e.button === 0) { mouseDownLeft = true; tryShoot(); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDownLeft = false; });

// Sound
const sound = new Sound();
sound.init();
if (volumeSlider) sound.setVolume((Number(volumeSlider.value) || 80) / 100);
sound.resume(); sound.startAmbient(); sound.startMusic();
function setAllVolume(v01) {
  sound.setVolume(v01);
  const val = Math.round(v01*100);
  if (volumeSlider) volumeSlider.value = String(val);
  if (volumeSliderPause) volumeSliderPause.value = String(val);
}
if (volumeSlider) volumeSlider.addEventListener('input', () => setAllVolume(Number(volumeSlider.value)/100));
if (volumeSliderPause) volumeSliderPause.addEventListener('input', () => setAllVolume(Number(volumeSliderPause.value)/100));

// Assets: preload manifest (safe if empty)
const assets = new Assets(sound.ctx);
await assets.loadAll(ASSET_MANIFEST);

// World + Rooms (asset-aware)
const world = new World(scene, assets);
const rooms = new RoomManager(world, null, (kind)=>applyPickup(kind), assets);
rooms.setTeleport((dest)=>controls.getObject().position.copy(dest));

// Rays
const groundRay = new THREE.Raycaster();

// State
const State = { HOME: 'home', RUN: 'run', PAUSE: 'pause', DEAD: 'dead' };
let state = State.HOME;

// Meta profile (kept from previous version, omitted here for brevity) — you can paste your shop code back in.

// Run state
let depth = 1;
let runGold = 0;
let spawnProtectedTime = 0;

const player = {
  velocity: new THREE.Vector3(0, 0, 0),
  baseSpeed: 6.2,
  sprintMult: 1.6,
  gravity: 20.0,
  jumpSpeed: 7.0,
  onGround: false,
  radius: 0.6,
  height: 1.7,
  maxHealth: 100,
  health: 100
};
world.playerHeight = player.height;

// Weapons
const weapons = {
  pistol: { name: 'Pistol', fireRate: 4, projSpeed: 70, pellets: 1, spreadDeg: 0.6, damage: 6, magSize: Infinity, reload: 0, auto: false },
  rifle:  { name: 'Rifle',  fireRate: 9, projSpeed: 85, pellets: 1, spreadDeg: 1.2, damage: 5, magSize: 30, reload: 1.5, auto: true },
  shotgun:{ name: 'Shotgun',fireRate: 1.2, projSpeed: 65, pellets: 7, spreadDeg: 7.5, damage: 3, magSize: 6, reload: 2.2, auto: false },
  smg:    { name: 'SMG',    fireRate: 13, projSpeed: 80, pellets: 1, spreadDeg: 2.0, damage: 4, magSize: 40, reload: 1.8, auto: true }
};
let unlockedWeapons = new Set(['pistol']);
let currentWeaponKey = 'pistol';
let nextFireTime = 0;
const ammo = {
  pistol: { mag: Infinity, reserve: Infinity },
  rifle:  { mag: 30, reserve: 90 },
  shotgun:{ mag: 6, reserve: 24 },
  smg:    { mag: 40, reserve: 160 }
};
let reloading = false;
let reloadTimeLeft = 0;

// Mods
const mods = { damageMult: 1.0, fireRateMult: 1.0, shieldTime: 0, critChance: 0.0, armorMult: 1.0, haste: 0.0 };
const modTimers = { damageMult: 0, fireRateMult: 0, critChance: 0, armorMult: 0, haste: 0 };

// First-person weapons: try assets first, fallback to primitives
const guns = { pistol: new THREE.Group(), rifle: new THREE.Group(), shotgun: new THREE.Group(), smg: new THREE.Group() };
let recoilT = 0;
function buildGunModels() {
  buildGun('pistol', 'gun_pistol_fp', { pos: [0.38, -0.32, -0.55], rot: [-0.05, 0.2, 0] }, () => {
    const g = guns.pistol;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: 0x394357, metalness: 0.5, roughness: 0.35 }));
    body.position.set(-0.05, -0.02, 0.25);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0xbad7ff, emissive: 0x1f3b7a, emissiveIntensity: 0.25, metalness: 0.8 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.set(0.18, -0.02, 0.38);
    g.add(body, barrel);
  });
  buildGun('rifle', 'gun_rifle_fp', { pos: [0.35, -0.35, -0.6], rot: [-0.06, 0.25, 0] }, () => {
    const g = guns.rifle;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 1.0), new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.55, roughness: 0.25 }));
    receiver.position.set(0, 0.02, 0.35);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x9aa2ff, emissive: 0x343cff, emissiveIntensity: 0.35, metalness: 0.8, roughness: 0.2 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.set(0.33, 0.03, 0.7);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.45), new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.55, roughness: 0.25 }));
    handguard.position.set(0.16, -0.02, 0.78);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.55, roughness: 0.25 }));
    stock.position.set(-0.35, -0.02, 0.1);
    g.add(receiver, barrel, handguard, stock);
  });
  buildGun('shotgun', 'gun_shotgun_fp', { pos: [0.35, -0.34, -0.58], rot: [-0.06, 0.2, 0] }, () => {
    const g = guns.shotgun;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.9), new THREE.MeshStandardMaterial({ color: 0x3b2f2f, metalness: 0.4, roughness: 0.4 }));
    body.position.set(0.02, 0.02, 0.35);
    const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xd6a88f, metalness: 0.6, roughness: 0.35 }));
    const barrel2 = barrel1.clone(); barrel1.rotation.z = barrel2.rotation.z = Math.PI / 2; barrel1.position.set(0.33, 0.05, 0.65); barrel2.position.set(0.33, -0.04, 0.65);
    g.add(body, barrel1, barrel2);
  });
  buildGun('smg', 'gun_smg_fp', { pos: [0.34, -0.33, -0.58], rot: [-0.06, 0.22, 0] }, () => {
    const g = guns.smg;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a4758, metalness: 0.55, roughness: 0.3 }));
    body.position.set(0.02, 0.02, 0.32);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x14b8a6, emissiveIntensity: 0.3, metalness: 0.8, roughness: 0.2 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.set(0.3, 0.02, 0.6);
    g.add(body, barrel);
  });

  function buildGun(key, assetKey, pose, fallbackBuilder) {
    const g = guns[key];
    const mdl = assets.cloneModel(assetKey);
    if (mdl) { g.add(mdl); }
    else { fallbackBuilder(); }
    g.position.set(...pose.pos); g.rotation.set(...pose.rot);
    camera.add(g);
  }
}
buildGunModels();

// Muzzle (primitive; you can swap to a model if you add one)
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
muzzle.visible = false; muzzle.position.set(0.45, -0.32, 0.05); camera.add(muzzle);

function showOnlyGun(key) {
  guns.pistol.visible = (key === 'pistol');
  guns.rifle.visible = (key === 'rifle');
  guns.shotgun.visible = (key === 'shotgun');
  guns.smg.visible = (key === 'smg');
}
function updateWeaponsUI() {
  slotPistol && slotPistol.classList.toggle('active', currentWeaponKey === 'pistol');
  slotRifle && slotRifle.classList.toggle('active', currentWeaponKey === 'rifle');
  slotShotgun && slotShotgun.classList.toggle('active', currentWeaponKey === 'shotgun');
  slotSMG && slotSMG.classList.toggle('active', currentWeaponKey === 'smg');
  if (slotRifle) slotRifle.classList.toggle('wlocked', !unlockedWeapons.has('rifle'));
  if (slotShotgun) slotShotgun.classList.toggle('wlocked', !unlockedWeapons.has('shotgun'));
  if (slotSMG) slotSMG.classList.toggle('wlocked', !unlockedWeapons.has('smg'));
  if (ammoPistol) ammoPistol.textContent = 'Ammo: ∞';
  if (ammoRifle) ammoRifle.textContent = `${ammo.rifle.mag} / ${ammo.rifle.reserve}`;
  if (ammoShotgun) ammoShotgun.textContent = `${ammo.shotgun.mag} / ${ammo.shotgun.reserve}`;
  if (ammoSMG) ammoSMG.textContent = `${ammo.smg.mag} / ${ammo.smg.reserve}`;
}
updateWeaponsUI(); showOnlyGun(currentWeaponKey);

// Start/end run (keep your Home/Death UI as before)
function startRun() {
  state = State.RUN;
  runGold = 0;
  depth = 1;

  world.startFloor(depth);
  rooms.generateNewFloor(depth);

  controls.getObject().position.set(0, player.height, 0);
  spawnProtectedTime = 1.2; if (protectedBadge) protectedBadge.style.display = 'inline-block';

  sound.resume(); sound.startAmbient(); sound.startMusic();
  if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();

  if (home) home.style.display = 'none';
  if (deathOverlay) deathOverlay.style.display = 'none';
  updateWeaponsUI(); showOnlyGun(currentWeaponKey);
}
function endRunToHome() {
  if (home) home.style.display = 'grid';
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (deathOverlay) deathOverlay.style.display = 'none';
  state = State.HOME;
}
function die() {
  if (state !== State.RUN) return;
  state = State.DEAD;
  if (document.exitPointerLock) document.exitPointerLock();
  if (deathOverlay) deathOverlay.style.display = 'grid';
}
if (home) home.style.display = 'grid';

startRunBtn && startRunBtn.addEventListener('click', () => startRun());
resumeBtn && resumeBtn.addEventListener('click', () => setPaused(false));
restartBtn && restartBtn.addEventListener('click', () => endRunToHome());
toHomeBtn && toHomeBtn.addEventListener('click', () => endRunToHome());
startAgainBtn && startAgainBtn.addEventListener('click', () => { if (home) home.style.display = 'none'; startRun(); });

// Pause
let isPaused = false;
function setPaused(p) {
  if (state !== State.RUN && !(state === State.PAUSE && !p)) return;
  isPaused = p; state = p ? State.PAUSE : State.RUN;
  if (pauseOverlay) pauseOverlay.style.display = p ? 'grid' : 'none';
  if (p) { if (document.exitPointerLock) document.exitPointerLock(); }
  else { if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state === State.RUN) setPaused(true);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === State.RUN) setPaused(true);
    else if (state === State.PAUSE) setPaused(false);
  }
  if (state === State.RUN && !isPaused) {
    if (e.code === 'Digit1') { if (unlockedWeapons.has('pistol')) currentWeaponKey = 'pistol'; }
    if (e.code === 'Digit2') { if (unlockedWeapons.has('rifle')) currentWeaponKey = 'rifle'; }
    if (e.code === 'Digit3') { if (unlockedWeapons.has('shotgun')) currentWeaponKey = 'shotgun'; }
    if (e.code === 'Digit4') { if (unlockedWeapons.has('smg')) currentWeaponKey = 'smg'; }
    if (e.code === 'KeyR') tryReload();
    updateWeaponsUI(); showOnlyGun(currentWeaponKey);
  }
});

// Shooting and movement (same as your latest; omitted here for brevity). Keep your existing tryShoot, updateControls, etc.
// Ensure you still tick mods.shieldTime down each frame as we fixed earlier.

function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }
window.addEventListener('resize', resize);
requestAnimationFrame(function loop(){ renderer.render(scene, camera); requestAnimationFrame(loop); });
