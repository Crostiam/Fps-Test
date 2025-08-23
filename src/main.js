import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input.js';
import { World } from './World.js';
import { Sound } from './Sound.js';
import { RoomManager } from './RoomManager.js';

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
const homeStats = document.getElementById('homeStats');
const shop = document.getElementById('shop');
const damageVignette = document.getElementById('damageVignette');
const protectedBadge = document.getElementById('protectedBadge');
const hint = document.getElementById('hint');

// Weapons UI
const slotPistol = document.getElementById('slotPistol');
const slotRifle = document.getElementById('slotRifle');
const slotShotgun = document.getElementById('slotShotgun');
const ammoPistol = document.getElementById('ammoPistol');
const ammoRifle = document.getElementById('ammoRifle');
const ammoShotgun = document.getElementById('ammoShotgun');

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
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
let interactPressed = false;
window.addEventListener('keydown', (e) => { if (e.code === 'KeyE') interactPressed = true; });

// World
const world = new World(scene);

// Rooms
const rooms = new RoomManager(world, null);

// Sound
const sound = new Sound();

// Rays
const groundRay = new THREE.Raycaster();

// Game state
const State = { HOME: 'home', RUN: 'run', PAUSE: 'pause', DEAD: 'dead' };
let state = State.HOME;

// Profile (meta-upgrades)
const STORAGE_KEY = 'fps-roguelike-profile';
function defaultProfile() {
  return {
    gold: 0,
    upgrades: {
      maxHealth: 0,
      damage: 0,
      fireRate: 0,
      speed: 0,
      startRifle: 0,
      startShotgun: 0
    }
  };
}
function loadProfile() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
  return defaultProfile();
}
function saveProfile() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch {} }
let profile = loadProfile();

// Upgrade shop
const UPGS = [
  { key: 'maxHealth', name: 'Max Health +10', desc: 'Start each run with +10 max HP per level.', baseCost: 50, grow: 1.35, max: 10 },
  { key: 'damage',    name: 'Damage +6%',     desc: 'Increase weapon damage by +6% per level.', baseCost: 60, grow: 1.35, max: 12 },
  { key: 'fireRate',  name: 'Fire Rate +6%',  desc: 'Increase fire rate by +6% per level.', baseCost: 60, grow: 1.35, max: 12 },
  { key: 'speed',     name: 'Move Speed +4%', desc: 'Increase move speed by +4% per level.', baseCost: 55, grow: 1.35, max: 10 },
  { key: 'startRifle',name: 'Start with Rifle', desc: 'Begin runs with rifle unlocked.', baseCost: 120, grow: 2.0, max: 1 },
  { key: 'startShotgun',name:'Start with Shotgun',desc:'Begin runs with shotgun unlocked.', baseCost: 160, grow: 2.0, max: 1 }
];
function upgradeCost(key, level) {
  const cfg = UPGS.find(u => u.key === key); if (!cfg) return 99999;
  let cost = cfg.baseCost;
  for (let i=0;i<level;i++) cost = Math.round(cost * cfg.grow);
  return cost;
}
function renderShop() {
  if (!shop || !homeStats) return;
  homeStats.textContent = `Wallet Gold: ${profile.gold}`;
  shop.innerHTML = '';
  for (let idx=0; idx<UPGS.length; idx++) {
    const u = UPGS[idx];
    const level = profile.upgrades[u.key] || 0;
    const maxed = u.max !== undefined && level >= u.max;
    const cost = maxed ? '-' : upgradeCost(u.key, level);
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <h3>${u.name}</h3>
      <p>${u.desc}</p>
      <div class="meta">Level: ${level}${u.max ? ' / ' + u.max : ''}</div>
      <button class="btn" ${maxed ? 'disabled' : ''} data-key="${u.key}">Buy (${cost})</button>
    `;
    const btn = el.querySelector('button');
    btn.addEventListener('click', () => {
      const cur = profile.upgrades[u.key] || 0;
      if (u.max && cur >= u.max) return;
      const c = upgradeCost(u.key, cur);
      if (profile.gold >= c) {
        profile.gold -= c;
        profile.upgrades[u.key] = cur + 1;
        saveProfile();
        renderShop();
      }
    });
    shop.appendChild(el);
  }
}
renderShop();

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

// Weapons
const weapons = {
  pistol: { name: 'Pistol', fireRate: 4, projSpeed: 70, pellets: 1, spreadDeg: 0.6, damage: 6, magSize: Infinity, reload: 0 },
  rifle:  { name: 'Rifle',  fireRate: 9, projSpeed: 85, pellets: 1, spreadDeg: 1.2, damage: 5, magSize: 30, reload: 1.5 },
  shotgun:{ name: 'Shotgun',fireRate: 1.2, projSpeed: 65, pellets: 7, spreadDeg: 7.5, damage: 3, magSize: 6, reload: 2.2 },
};
let unlockedWeapons = new Set(['pistol']);
let currentWeaponKey = 'pistol';
let nextFireTime = 0;
const ammo = {
  pistol: { mag: Infinity, reserve: Infinity },
  rifle:  { mag: 30, reserve: 90 },
  shotgun:{ mag: 6, reserve: 24 }
};
let reloading = false;
let reloadTimeLeft = 0;

// Powerup modifiers (temporary)
const mods = { damageMult: 1.0, fireRateMult: 1.0, shieldTime: 0 };
const modTimers = { damageMult: 0, fireRateMult: 0 };

// Apply meta upgrades
function applyUpgrades() {
  const u = profile.upgrades || {};
  player.maxHealth = 100 + (u.maxHealth || 0) * 10;
  player.health = player.maxHealth;
  const spdMult = 1 + (u.speed || 0) * 0.04;
  player.baseSpeed = 6.2 * spdMult;
  mods.damageMult = 1.0 + (u.damage || 0) * 0.06;
  mods.fireRateMult = 1.0 + (u.fireRate || 0) * 0.06;

  unlockedWeapons = new Set(['pistol']);
  if (u.startRifle) unlockedWeapons.add('rifle');
  if (u.startShotgun) unlockedWeapons.add('shotgun');
  currentWeaponKey = unlockedWeapons.has('rifle') ? 'rifle' : 'pistol';

  // Reset ammo for a new run
  ammo.rifle.mag = 30; ammo.rifle.reserve = 90;
  ammo.shotgun.mag = 6; ammo.shotgun.reserve = 24;
  reloading = false; reloadTimeLeft = 0;
}

// Weapon models (3 different)
const guns = {
  pistol: new THREE.Group(),
  rifle: new THREE.Group(),
  shotgun: new THREE.Group()
};
let recoilT = 0;

function buildGunModels() {
  // Pistol
  {
    const g = guns.pistol;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: 0x394357, metalness: 0.5, roughness: 0.35 }));
    body.position.set(-0.05, -0.02, 0.25);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0xbad7ff, emissive: 0x1f3b7a, emissiveIntensity: 0.25, metalness: 0.8 }));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(0.18, -0.02, 0.38);
    g.add(body, barrel);
    g.position.set(0.38, -0.32, -0.55);
    g.rotation.set(-0.05, 0.2, 0);
    camera.add(g);
  }
  // Rifle
  {
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
    g.position.set(0.35, -0.35, -0.6);
    g.rotation.set(-0.06, 0.25, 0.0);
    camera.add(g);
  }
  // Shotgun
  {
    const g = guns.shotgun;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.9), new THREE.MeshStandardMaterial({ color: 0x3b2f2f, metalness: 0.4, roughness: 0.4 }));
    body.position.set(0.02, 0.02, 0.35);
    const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xd6a88f, metalness: 0.6, roughness: 0.35 }));
    const barrel2 = barrel1.clone();
    barrel1.rotation.z = barrel2.rotation.z = Math.PI / 2;
    barrel1.position.set(0.33, 0.05, 0.65);
    barrel2.position.set(0.33, -0.04, 0.65);
    g.add(body, barrel1, barrel2);
    g.position.set(0.35, -0.34, -0.58);
    g.rotation.set(-0.06, 0.2, 0);
    camera.add(g);
  }
  scene.add(camera);
}
buildGunModels();

// Muzzle flash
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
muzzle.visible = false; muzzle.position.set(0.45, -0.32, 0.05); camera.add(muzzle);

// Helpers
function showOnlyGun(key) {
  guns.pistol.visible = (key === 'pistol');
  guns.rifle.visible = (key === 'rifle');
  guns.shotgun.visible = (key === 'shotgun');
}
function updateWeaponsUI() {
  slotPistol.classList.remove('active'); slotRifle.classList.remove('active'); slotShotgun.classList.remove('active');
  slotPistol.classList.remove('wlocked'); slotRifle.classList.remove('wlocked'); slotShotgun.classList.remove('wlocked');
  if (!unlockedWeapons.has('rifle')) slotRifle.classList.add('wlocked');
  if (!unlockedWeapons.has('shotgun')) slotShotgun.classList.add('wlocked');
  const active = currentWeaponKey === 'pistol' ? slotPistol : currentWeaponKey === 'rifle' ? slotRifle : slotShotgun;
  active.classList.add('active');

  ammoPistol.textContent = 'Ammo: ∞';
  ammoRifle.textContent = `${ammo.rifle.mag} / ${ammo.rifle.reserve}`;
  ammoShotgun.textContent = `${ammo.shotgun.mag} / ${ammo.shotgun.reserve}`;
}
updateWeaponsUI();
showOnlyGun(currentWeaponKey);

// Start/end run flow
function startRun() {
  state = State.RUN;
  runGold = 0;
  depth = 1;
  applyUpgrades();
  world.startFloor(depth);

  // Rebuild room gates on new run/floor
  // (Rooms are built from lairs in constructor; fine for now.)

  // Spawn and protection
  controls.getObject().position.copy(world.getSpawnPointInsideHouse());
  spawnProtectedTime = 2.0;
  if (protectedBadge) protectedBadge.style.display = 'inline-block';

  // Audio + pointer lock
  if (!sound.ctx) sound.init();
  sound.resume();
  sound.startAmbient();
  if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();

  home.style.display = 'none';
  deathOverlay.style.display = 'none';
  updateWeaponsUI();
  showOnlyGun(currentWeaponKey);
}
function endRunToHome() {
  profile.gold += runGold; saveProfile(); renderShop();
  home.style.display = 'grid';
  pauseOverlay.style.display = 'none';
  deathOverlay.style.display = 'none';
  state = State.HOME;
}
function die() {
  if (state !== State.RUN) return;
  state = State.DEAD;
  profile.gold += runGold; saveProfile(); renderShop();
  const ds = document.getElementById('deathStats');
  if (ds) ds.textContent = `Gold collected: ${runGold} | Depth reached: ${depth}`;
  if (document.exitPointerLock) document.exitPointerLock();
  deathOverlay.style.display = 'grid';
}

// UI events
startRunBtn.addEventListener('click', () => startRun());
resumeBtn.addEventListener('click', () => setPaused(false));
restartBtn.addEventListener('click', () => endRunToHome());
toHomeBtn.addEventListener('click', () => endRunToHome());
startAgainBtn.addEventListener('click', () => { home.style.display = 'none'; startRun(); });

// Pause handling
let isPaused = false;
function setPaused(p) {
  if (state !== State.RUN && !(state === State.PAUSE && !p)) return;
  isPaused = p;
  state = p ? State.PAUSE : State.RUN;
  pauseOverlay.style.display = p ? 'grid' : 'none';
  if (p) {
    if (document.exitPointerLock) document.exitPointerLock();
  } else {
    if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
  }
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
    if (e.code === 'KeyR') tryReload();
    updateWeaponsUI();
    showOnlyGun(currentWeaponKey);
  }
});

// Shooting
window.addEventListener('mousedown', (e) => {
  if (state !== State.RUN || isPaused) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) tryShoot();
});

function canFire() {
  const now = performance.now() / 1000;
  const def = weapons[currentWeaponKey];
  const fireRate = def.fireRate * mods.fireRateMult;
  if (reloading) return false;
  if (now < nextFireTime) return false;
  if (currentWeaponKey === 'pistol') return true;
  const a = ammo[currentWeaponKey];
  return a.mag > 0;
}

function tryShoot() {
  const def = weapons[currentWeaponKey];
  if (!canFire()) {
    if (currentWeaponKey !== 'pistol') {
      if (!sound.ctx) sound.init(); sound.playEmpty();
    }
    return;
  }
  const now = performance.now() / 1000;
  const fireRate = def.fireRate * mods.fireRateMult;
  nextFireTime = now + 1 / Math.max(0.01, fireRate);

  if (currentWeaponKey !== 'pistol') {
    ammo[currentWeaponKey].mag = Math.max(0, ammo[currentWeaponKey].mag - 1);
  }
  updateWeaponsUI();

  shootWeapon(def);
}

function tryReload() {
  if (currentWeaponKey === 'pistol') return;
  if (reloading) return;
  const a = ammo[currentWeaponKey];
  const def = weapons[currentWeaponKey];
  if (a.mag >= def.magSize) return;
  if (a.reserve <= 0) return;
  reloading = true;
  reloadTimeLeft = def.reload;
  if (!sound.ctx) sound.init(); sound.playReload();
}

function completeReload() {
  const a = ammo[currentWeaponKey];
  const def = weapons[currentWeaponKey];
  const need = def.magSize - a.mag;
  const take = Math.min(need, a.reserve);
  a.mag += take;
  a.reserve -= take;
  reloading = false;
  updateWeaponsUI();
}

function shootWeapon(def) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const origin = camera.position.clone();
  const start = origin.clone().add(forward.clone().multiplyScalar(0.2));

  for (let i = 0; i < def.pellets; i++) {
    const yaw = (Math.random() - 0.5) * def.spreadDeg;
    const pitch = (Math.random() - 0.5) * def.spreadDeg;
    const dir = forward.clone()
      .add(right.clone().multiplyScalar(Math.tan((yaw * Math.PI)/180)))
      .add(up.clone().multiplyScalar(Math.tan((pitch * Math.PI)/180)))
      .normalize();
    const damage = Math.round(def.damage * mods.damageMult);
    world.spawnProjectile(start, dir, def.projSpeed, 'player', 2.0, damage);
  }

  muzzle.visible = true; setTimeout(() => (muzzle.visible = false), 50);
  if (!sound.ctx) sound.init(); sound.playShot();
  recoilT = 0.12;
}

function onPlayerHit(dmg) {
  if (spawnProtectedTime > 0 || mods.shieldTime > 0) return;
  player.health = Math.max(0, player.health - dmg);
  damageVignette.style.opacity = '1'; setTimeout(() => damageVignette.style.opacity = '0', 120);
  if (!sound.ctx) sound.init(); sound.playHit();
  if (player.health <= 0) die();
}
function onEnemyShot() { if (!sound.ctx) sound.init(); sound.playEnemyShot(); }

// Movement
const moveDir = new THREE.Vector3();
const fwd = new THREE.Vector3();
const rightV = new THREE.Vector3();

let stepTimer = 0;
function updateControls(dt) {
  fwd.set(0,0,-1).applyQuaternion(camera.quaternion);
  rightV.set(1,0,0).applyQuaternion(camera.quaternion);
  fwd.y = 0; rightV.y = 0; fwd.normalize(); rightV.normalize();

  moveDir.set(0,0,0);
  if (input.forward) moveDir.add(fwd);
  if (input.back) moveDir.sub(fwd);
  if (input.right) moveDir.add(rightV);
  if (input.left) moveDir.sub(rightV);

  const isMoving = moveDir.lengthSq() > 0.0001;
  if (isMoving) moveDir.normalize();

  const speed = player.baseSpeed * (input.sprint ? player.sprintMult : 1);
  const accel = isMoving ? 30 : 20;
  const desiredVX = moveDir.x * speed;
  const desiredVZ = moveDir.z * speed;
  player.velocity.x += (desiredVX - player.velocity.x) * Math.min(1, accel * dt);
  player.velocity.z += (desiredVZ - player.velocity.z) * Math.min(1, accel * dt);

  player.velocity.y -= player.gravity * dt;
  if (input.jump && player.onGround) {
    player.velocity.y = player.jumpSpeed;
    player.onGround = false;
  }

  const obj = controls.getObject();
  const nextPos = obj.position.clone().addScaledVector(player.velocity, dt);

  groundRay.set(new THREE.Vector3(nextPos.x, nextPos.y, nextPos.z), new THREE.Vector3(0, -1, 0));
  groundRay.near = 0; groundRay.far = player.height + 0.5;
  const groundHits = groundRay.intersectObjects(scene.children, true)
    .filter(h => ['floor','obstacle','house_wall','arena_wall','rock','castle_wall','castle_tower','pyramid_base','pyramid_wall','ice_wall','ice_crystal'].includes(h.object.name))
    .sort((a,b)=>a.distance-b.distance);
  const hit = groundHits[0];
  if (hit && hit.distance <= player.height + 0.05 && player.velocity.y <= 0) {
    nextPos.y = hit.point.y + player.height;
    player.velocity.y = 0; player.onGround = true;
  } else { player.onGround = false; }

  world.resolveCollisions(nextPos, player.radius, player.height);

  const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  stepTimer -= dt;
  if (player.onGround && horizSpeed > 2.0 && stepTimer <= 0) {
    if (!sound.ctx) sound.init(); sound.playStep();
    stepTimer = 0.42 / Math.min(3, horizSpeed);
  }

  obj.position.copy(nextPos);
}

// Pickups
function applyPickup(kind) {
  if (!sound.ctx) sound.init(); sound.playPickup();
  switch (kind) {
    case 'health': player.health = Math.min(player.maxHealth, player.health + 25); break;
    case 'shield': mods.shieldTime = Math.max(mods.shieldTime, 6.0); break;
    case 'damage': mods.damageMult = (1.0 + (profile.upgrades.damage || 0)*0.06) * 1.6; modTimers.damageMult = 12.0; break;
    case 'firerate': mods.fireRateMult = (1.0 + (profile.upgrades.fireRate || 0)*0.06) * 1.6; modTimers.fireRateMult = 12.0; break;
    case 'weapon_rifle': unlockedWeapons.add('rifle'); currentWeaponKey = 'rifle'; break;
    case 'weapon_shotgun': unlockedWeapons.add('shotgun'); currentWeaponKey = 'shotgun'; break;
    case 'ammo_rifle': ammo.rifle.reserve += 60; break;
    case 'ammo_shotgun': ammo.shotgun.reserve += 18; break;
  }
  updateWeaponsUI();
  showOnlyGun(currentWeaponKey);
}

function onGoldPickup(amount) {
  runGold += amount;
  if (!sound.ctx) sound.init(); sound.playCoin();
}

// Resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

// Main loop
let lastTime = performance.now();
let acc = 0, frames = 0, fps = 0;

function loop() {
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (state === State.RUN) {
    // Reload timer
    if (reloading) {
      reloadTimeLeft -= dt;
      if (reloadTimeLeft <= 0) completeReload();
    }

    if (document.pointerLockElement === renderer.domElement && !isPaused) {
      updateControls(dt);
    }

    const playerPos = controls.getObject().position;

    // World update
    world.update(dt, playerPos, function(dmg){ onPlayerHit(dmg); }, function(){ onEnemyShot(); }, spawnProtectedTime <= 0 && mods.shieldTime <= 0);

    // Rooms update (clear detection, rewards, gating resume)
    rooms.update(dt);

    // Timers
    if (spawnProtectedTime > 0) {
      spawnProtectedTime = Math.max(0, spawnProtectedTime - dt);
      if (spawnProtectedTime === 0 && protectedBadge) protectedBadge.style.display = 'none';
    }
    if (mods.shieldTime > 0) mods.shieldTime = Math.max(0, mods.shieldTime - dt);
    if (modTimers.damageMult > 0) { modTimers.damageMult = Math.max(0, modTimers.damageMult - dt); if (modTimers.damageMult === 0) mods.damageMult = 1.0 + (profile.upgrades.damage || 0)*0.06; }
    if (modTimers.fireRateMult > 0) { modTimers.fireRateMult = Math.max(0, modTimers.fireRateMult - dt); if (modTimers.fireRateMult === 0) mods.fireRateMult = 1.0 + (profile.upgrades.fireRate || 0)*0.06; }

    // Auto-pick gold by capsule
    world.checkPlayerPickups(playerPos, player.height, function(kind){ applyPickup(kind); }, function(amt){ onGoldPickup(amt); });

    // Interaction priority: reward/powerup prompt, then room entry, then portal text
    let promptShown = false;

    // Powerup interaction (nearest)
    const nearP = world.getNearestPowerup(playerPos, 1.6);
    if (nearP) {
      const label = nearP.userData && nearP.userData.label ? nearP.userData.label : 'Powerup';
      hint.textContent = `Press E to pick up: ${label}`;
      hint.style.display = 'block';
      promptShown = true;
      if (interactPressed) {
        const kind = world.removePowerup(nearP);
        applyPickup(kind);
      }
    }

    // Room entry (if not already in a room)
    if (!promptShown && !rooms.isInRoom()) {
      const nearRoom = rooms.getEnterableRoom(playerPos, 2.2);
      if (nearRoom) {
        hint.textContent = `Press E to enter ${nearRoom.kind.toUpperCase()} room`;
        hint.style.display = 'block';
        promptShown = true;
        if (interactPressed) {
          rooms.enterRoom(nearRoom);
        }
      }
    }

    // Portal hint
    const nearPortal = world.checkPortalEntry(playerPos);
    if (!promptShown) {
      hint.style.display = nearPortal ? 'block' : 'none';
      if (nearPortal) hint.textContent = 'Enter portal to go deeper';
    }

    // Floor transition via portal
    if (nearPortal) {
      depth += 1;
      world.clearPortals();
      if (!sound.ctx) sound.init(); sound.playPortal();
      world.startFloor(depth);
      // Note: gates rebuilt by RoomManager constructor initially; existing gates remain fine for now.
      player.health = Math.min(player.maxHealth, player.health + Math.round(player.maxHealth * 0.25));
      spawnProtectedTime = 1.5; if (protectedBadge) protectedBadge.style.display = 'inline-block';
      reloading = false; reloadTimeLeft = 0;
    }

    interactPressed = false;

    // Gun sway/recoil
    animateGun(now*0.001, dt);
  }

  renderer.render(scene, camera);

  // HUD
  acc += dt; frames++; if (acc >= 0.25) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
  const wname = weapons[currentWeaponKey].name;
  hud.textContent = `Depth: ${depth} | Gold: ${runGold} | Health: ${player.health}/${player.maxHealth} | Weapon: ${wname} | FPS: ${fps}`;

  requestAnimationFrame(loop);
}
function animateGun(t, dt) {
  const v = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 6);
  const sway = Math.sin(t * 6.0) * 0.004 * v;
  const bob = Math.cos(t * 12.0) * 0.002 * v;
  if (recoilT > 0) recoilT = Math.max(0, recoilT - dt);
  const r = recoilT > 0 ? (recoilT / 0.12) : 0; const kick = r * 0.06;

  const g = guns[currentWeaponKey];
  g.position.x = (currentWeaponKey === 'pistol' ? 0.38 : 0.35) + sway;
  g.position.y = (currentWeaponKey === 'pistol' ? -0.32 : -0.35) + bob - kick*0.5;
  g.rotation.x = (currentWeaponKey === 'pistol' ? -0.05 : -0.06) - kick;
}

resize(); requestAnimationFrame(loop);
