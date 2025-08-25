import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input.js';
import { World } from './World.js';
import { Sound } from './Sound.js';
import { RoomManager } from './RoomManager.js';
import { Assets } from './Assets.js';
import { ASSET_MANIFEST } from './assets-manifest.js';

// ==============================
// DOM
// ==============================
const app = document.getElementById('app');
const hud = document.getElementById('hud');
const home = document.getElementById('home');
const pauseOverlay = document.getElementById('pauseOverlay');
const deathOverlay = document.getElementById('death');
const deathStats = document.getElementById('deathStats');
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

const shopEl = document.getElementById('shop');

// ==============================
// Three.js basics
// ==============================
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

// Pointer lock wiring and diagnostics
controls.addEventListener('lock', () => {
  if (state === State.PAUSE) {
    isPaused = false;
    state = State.RUN;
    if (pauseOverlay) pauseOverlay.style.display = 'none';
  }
});
controls.addEventListener('unlock', () => {
  if (state === State.RUN) setPaused(true);
});
document.addEventListener('pointerlockerror', (e) => {
  console.warn('Pointer Lock error:', e);
});
// Canvas click fallback to request lock when running
renderer.domElement.addEventListener('click', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state === State.RUN && !isPaused) {
    try { controls.lock(); } catch (e) { console.warn('controls.lock() on canvas click failed:', e); }
  }
});

// ==============================
// Input
// ==============================
const input = new Input();
let interactPressed = false;
let mouseDownLeft = false;
let allowFallbackMove = false; // <== Added for fallback movement guard
window.addEventListener('keydown', (e) => { if (e.code === 'KeyE') interactPressed = true; });
window.addEventListener('mousedown', (e) => {
  if (state !== State.RUN || isPaused) return;
  if (e.button === 0) { mouseDownLeft = true; tryShoot(); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDownLeft = false; });

// Minimal WASD movement fallback (if World.update doesn't handle it)
const keys = { w:false, a:false, s:false, d:false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') keys.w = true;
  if (e.code === 'KeyA') keys.a = true;
  if (e.code === 'KeyS') keys.s = true;
  if (e.code === 'KeyD') keys.d = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') keys.w = false;
  if (e.code === 'KeyA') keys.a = false;
  if (e.code === 'KeyS') keys.s = false;
  if (e.code === 'KeyD') keys.d = false;
});

// ==============================
// Sound
// ==============================
const sound = new Sound();
sound.init();
if (volumeSlider) sound.setVolume((Number(volumeSlider.value) || 80) / 100);
sound.resume(); sound.startAmbient(); sound.startMusic();
function setAllVolume(v01) {
  sound.setVolume(v01);
  const val = Math.round(v01 * 100);
  if (volumeSlider) volumeSlider.value = String(val);
  if (volumeSliderPause) volumeSliderPause.value = String(val);
}
if (volumeSlider) volumeSlider.addEventListener('input', () => setAllVolume(Number(volumeSlider.value) / 100));
if (volumeSliderPause) volumeSliderPause.addEventListener('input', () => setAllVolume(Number(volumeSliderPause.value) / 100));

// ==============================
// Globals filled in bootstrap
// ==============================
let assets;
let world;
let rooms;

// Rays
const groundRay = new THREE.Raycaster();

// ==============================
// State
// ==============================
const State = { HOME: 'home', RUN: 'run', PAUSE: 'pause', DEAD: 'dead' };
let state = State.HOME;

// Run state
let depth = 1;
let runGold = 0;
let spawnProtectedTime = 0;

// ==============================
// Player
// ==============================
const BASE_MAX_HEALTH = 100;
const BASE_SPEED = 6.2;

const player = {
  velocity: new THREE.Vector3(0, 0, 0),
  baseSpeed: BASE_SPEED,
  sprintMult: 1.6,
  gravity: 20.0,
  jumpSpeed: 7.0,
  onGround: false,
  radius: 0.6,
  height: 1.7,
  maxHealth: BASE_MAX_HEALTH,
  health: BASE_MAX_HEALTH
};

// ==============================
// Weapons
// ==============================
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

// ==============================
// Mods (temporary in-run). Permanent upgrades are applied at run start.
// ==============================
const mods = { damageMult: 1.0, fireRateMult: 1.0, shieldTime: 0, critChance: 0.0, armorMult: 1.0, haste: 0.0 };
const modTimers = { damageMult: 0, fireRateMult: 0, critChance: 0, armorMult: 0, haste: 0 };

// ==============================
// SHOP (Meta progression; persists in localStorage)
// ==============================
const LS_KEY = 'fps_meta_v1';
const meta = loadMeta();

function loadMeta() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    wallet: 0,
    upgrades: {
      maxhpLvl: 0,       // +10 Max HP per level
      dmgLvl: 0,         // +6% damage per level
      firerateLvl: 0,    // +6% fire rate per level
      speedLvl: 0,       // +4% move speed per level
      startRifle: false, // start with Rifle
      startShotgun: false// start with Shotgun
    }
  };
}
function saveMeta() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(meta)); } catch {}
}
function gold(cost) { return Math.max(0, Math.floor(cost)); }
function costLinear(base, step, lvl) { return gold(base + step * lvl); }

function renderShop() {
  if (!shopEl) return;
  const u = meta.upgrades;

  const items = [
    {
      key: 'maxhpLvl', name: 'Max Health +10', desc: `Increase max HP by 10 (stacking)`,
      level: u.maxhpLvl, effect: `Current: ${BASE_MAX_HEALTH + u.maxhpLvl*10} HP`,
      cost: costLinear(60, 60, u.maxhpLvl), type: 'level'
    },
    {
      key: 'dmgLvl', name: 'Damage +6%', desc: `Increase weapon damage by 6% (stacking)`,
      level: u.dmgLvl, effect: `Current: ${(100*(1+0.06*u.dmgLvl)).toFixed(0)}%`,
      cost: costLinear(80, 70, u.dmgLvl), type: 'level'
    },
    {
      key: 'firerateLvl', name: 'Fire Rate +6%', desc: `Increase fire rate by 6% (stacking)`,
      level: u.firerateLvl, effect: `Current: ${(100*(1+0.06*u.firerateLvl)).toFixed(0)}%`,
      cost: costLinear(80, 70, u.firerateLvl), type: 'level'
    },
    {
      key: 'speedLvl', name: 'Speed +4%', desc: `Increase move speed by 4% (stacking)`,
      level: u.speedLvl, effect: `Current: ${(100*(1+0.04*u.speedLvl)).toFixed(0)}%`,
      cost: costLinear(70, 60, u.speedLvl), type: 'level'
    },
    {
      key: 'startRifle', name: 'Start with Rifle', desc: `Begin each run with Rifle unlocked (30/90 ammo)` ,
      owned: u.startRifle, cost: 300, type: 'boolean'
    },
    {
      key: 'startShotgun', name: 'Start with Shotgun', desc: `Begin each run with Shotgun unlocked (6/24 ammo)` ,
      owned: u.startShotgun, cost: 350, type: 'boolean'
    }
  ];

  const parts = [];
  parts.push(`<div class="panel">`);
  parts.push(`<h2 style="margin:0 0 8px 0;">Upgrades Shop</h2>`);
  parts.push(`<div style="color:#cbd5e1;font-size:13px;margin-bottom:8px;">Wallet: <strong>${meta.wallet}</strong> gold</div>`);
  // Two columns
  parts.push(`<div class="grid" style="grid-template-columns: repeat(2, minmax(280px, 360px));">`);
  for (const it of items) {
    const id = `buy_${it.key}`;
    const disabled = (it.type === 'boolean' && it.owned) || meta.wallet < it.cost;
    const ownedStr = it.type === 'boolean' ? (it.owned ? `Owned` : `Not owned`) : `Level ${it.level}`;
    const effectStr = it.effect ? `<div style="font-size:12px;color:#94a3b8;">${it.effect}</div>` : '';
    parts.push(`
      <div style="border:1px solid #2e3040;padding:10px;border-radius:10px;text-align:left;background:#0f1320;">
        <div style="font-weight:700;color:#e2e8f0;">${it.name}</div>
        <div style="font-size:12px;color:#a8b1c3;margin:4px 0;">${it.desc}</div>
        ${effectStr}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <div style="font-size:12px;color:#cbd5e1;">${ownedStr} • Cost: ${it.cost}</div>
          <button id="${id}" class="btn ${disabled ? 'secondary' : ''}" ${disabled ? 'disabled' : ''} style="margin:0;">Buy</button>
        </div>
      </div>
    `);
  }
  parts.push(`</div></div>`);
  shopEl.innerHTML = parts.join('');

  // Wire buttons
  for (const it of items) {
    const btn = document.getElementById(`buy_${it.key}`);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      if (it.type === 'level') {
        const cost = it.cost;
        if (meta.wallet < cost) return;
        meta.wallet -= cost;
        meta.upgrades[it.key] = (meta.upgrades[it.key] || 0) + 1;
      } else {
        const cost = it.cost;
        if (meta.wallet < cost) return;
        if (meta.upgrades[it.key]) return;
        meta.wallet -= cost;
        meta.upgrades[it.key] = true;
      }
      saveMeta();
      renderShop();
    });
  }
}

// Apply meta to current run (called in startRun)
function applyMetaToRun() {
  const u = meta.upgrades;
  // Reset to base then apply
  player.maxHealth = BASE_MAX_HEALTH + (u.maxhpLvl || 0) * 10;
  player.health = player.maxHealth;
  player.baseSpeed = BASE_SPEED * (1 + 0.04 * (u.speedLvl || 0));

  // Permanent multipliers apply to temporary mods baseline
  mods.damageMult = 1.0 * (1 + 0.06 * (u.dmgLvl || 0));
  mods.fireRateMult = 1.0 * (1 + 0.06 * (u.firerateLvl || 0));

  // Starting weapons
  unlockedWeapons = new Set(['pistol']);
  if (u.startRifle) unlockedWeapons.add('rifle');
  if (u.startShotgun) unlockedWeapons.add('shotgun');

  // Ensure starting ammo reasonable
  if (u.startRifle) { ammo.rifle.mag = 30; ammo.rifle.reserve = Math.max(ammo.rifle.reserve, 90); }
  if (u.startShotgun) { ammo.shotgun.mag = 6; ammo.shotgun.reserve = Math.max(ammo.shotgun.reserve, 24); }

  // Keep selected weapon sensible
  if (!unlockedWeapons.has(currentWeaponKey)) currentWeaponKey = 'pistol';
  updateWeaponsUI();
  showOnlyGun(currentWeaponKey);
}

// Helper for awarding gold during the run
function addGold(n) { runGold += Math.max(0, Math.floor(n)); }

// ==============================
// First-person weapons: assets (if any) or primitives
// ==============================
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
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x9aa2ff, emissive: 0x343cff, emissiveIntensity: 0.35, metalness: 0.8, roughness: 0.25 }));
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
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x14b8a6, emissiveIntensity: 0.3, metalness: 0.8, roughness: 0.26 }));
    barrel.rotation.z = Math.PI / 2; barrel.position.set(0.3, 0.02, 0.6);
    g.add(body, barrel);
  });

  function buildGun(key, assetKey, pose, fallbackBuilder) {
    const g = guns[key];
    const mdl = assets && assets.cloneModel ? assets.cloneModel(assetKey) : null;
    if (mdl) { g.add(mdl); }
    else { fallbackBuilder(); }
    g.position.set(...pose.pos); g.rotation.set(...pose.rot);
    camera.add(g);
  }
}

// Muzzle flash (primitive)
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

// ==============================
// Pause
// ==============================
let isPaused = false;
function setPaused(p) {
  if (state !== State.RUN && !(state === State.PAUSE && !p)) return;
  isPaused = p; state = p ? State.PAUSE : State.RUN;
  if (pauseOverlay) pauseOverlay.style.display = p ? 'grid' : 'none';
  if (p) {
    try { controls.unlock(); } catch {}
  } else {
    // Do not auto-lock here; rely on button/canvas click (user gesture)
  }
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === State.RUN) setPaused(true);
    else if (state === State.PAUSE) {
      setPaused(false);
      // user gesture via key may not be accepted by all browsers; use canvas click if needed
      try { controls.lock(); } catch (err) {}
    }
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

// ==============================
// START/END RUN
// ==============================
function startRun() {
  state = State.RUN;
  runGold = 0;
  depth = 1;

  // Apply meta upgrades to player and loadout for this new run
  applyMetaToRun();

  if (world) world.startFloor(depth);
  if (rooms) rooms.generateNewFloor(depth);

  controls.getObject().position.set(0, player.height, 0);
  spawnProtectedTime = 1.2; if (protectedBadge) protectedBadge.style.display = 'inline-block';

  // Hide overlays BEFORE locking
  if (home) home.style.display = 'none';
  if (deathOverlay) deathOverlay.style.display = 'none';
  if (pauseOverlay) pauseOverlay.style.display = 'none';

  sound.resume(); sound.startAmbient(); sound.startMusic();

  // Request pointer lock using the controls API; must be from user gesture (Start button click)
  try { controls.lock(); } catch (e) { console.warn('controls.lock() failed:', e); }

  updateWeaponsUI(); showOnlyGun(currentWeaponKey);
}
function endRunToHome() {
  // Bank gold to wallet
  if (runGold > 0) {
    meta.wallet += runGold;
    saveMeta();
  }
  if (home) home.style.display = 'grid';
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (deathOverlay) deathOverlay.style.display = 'none';
  state = State.HOME;
  renderShop();
}
function die() {
  if (state !== State.RUN) return;
  state = State.DEAD;
  try { controls.unlock(); } catch {}
  if (deathOverlay) deathOverlay.style.display = 'grid';
  // Bank gold and show stats
  if (runGold > 0) {
    meta.wallet += runGold;
    saveMeta();
  }
  if (deathStats) deathStats.textContent = `Gold collected: ${runGold} (Wallet: ${meta.wallet})`;
}

// ==============================
// PICKUPS
// ==============================
function applyPickup(kind) {
  if (sound.playPickup) sound.playPickup();
  switch (kind) {
    case 'health': player.health = Math.min(player.maxHealth, player.health + 25); break;
    case 'shield': mods.shieldTime = Math.max(mods.shieldTime, 6.0); break;
    case 'damage': mods.damageMult = 1.6; modTimers.damageMult = 12.0; break;
    case 'firerate': mods.fireRateMult = 1.6; modTimers.fireRateMult = 12.0; break;
    case 'weapon_rifle': unlockedWeapons.add('rifle'); currentWeaponKey = 'rifle'; break;
    case 'weapon_shotgun': unlockedWeapons.add('shotgun'); currentWeaponKey = 'shotgun'; break;
    case 'weapon_smg': unlockedWeapons.add('smg'); currentWeaponKey = 'smg'; break;
    case 'ammo_rifle': ammo.rifle.reserve += 90; break;
    case 'ammo_shotgun': ammo.shotgun.reserve += 24; break;
    case 'ammo_smg': ammo.smg.reserve += 160; break;
    case 'crit': mods.critChance = 0.22; modTimers.critChance = 12.0; break;
    case 'armor': mods.armorMult = 0.8; modTimers.armorMult = 12.0; break;
    case 'haste': mods.haste = 0.25; modTimers.haste = 10.0; break;
  }
  updateWeaponsUI(); showOnlyGun(currentWeaponKey);
}
function onGoldPickup(amount) { runGold += amount; if (sound.playCoin) sound.playCoin(); }

// ==============================
// Reload logic
// ==============================
function tryReload() {
  if (reloading) return;
  if (currentWeaponKey === 'pistol') return; // infinite
  const a = ammo[currentWeaponKey];
  const w = weapons[currentWeaponKey];
  if (!a || !w) return;
  const need = w.magSize - a.mag;
  if (need <= 0 || a.reserve <= 0) return;
  reloading = true;
  reloadTimeLeft = w.reload;
  setTimeout(() => {
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    reloading = false;
    reloadTimeLeft = 0;
    updateWeaponsUI();
  }, Math.max(0, w.reload) * 1000);
}

// ==============================
// Simple shoot stub
// ==============================
function tryShoot() {
  const now = performance.now() / 1000;
  const w = weapons[currentWeaponKey];
  if (!w) return;
  if (reloading) return;
  const fireGap = (1 / (w.fireRate * (mods.fireRateMult || 1)));
  if (now < nextFireTime) return;

  // Ammo check
  const a = ammo[currentWeaponKey];
  if (currentWeaponKey !== 'pistol') {
    if (!a || a.mag <= 0) { return; }
    a.mag -= 1;
    updateWeaponsUI();
  }

  nextFireTime = now + fireGap;

  // Muzzle flash
  muzzle.visible = true;
  setTimeout(() => { muzzle.visible = false; }, 40);

  // ---- CALL world.fireShot if available ----
  if (world && typeof world.fireShot === 'function') {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

    const wdef = weapons[currentWeaponKey] || {};
    world.fireShot({
      origin,
      dir,
      weapon: currentWeaponKey,
      pellets: wdef.pellets ?? 1,
      spreadDeg: wdef.spreadDeg ?? 0,
      projSpeed: wdef.projSpeed ?? 200,
      damage: (wdef.damage ?? 1) * (mods.damageMult || 1),
      critChance: mods.critChance || 0
    });
  }
  // ---- END ----

  if (sound.playShoot) sound.playShoot(currentWeaponKey);
}

// ==============================
// Resize + loop
// ==============================
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

// Main render loop
const clock = new THREE.Clock();
function loop() {
  const dt = clock.getDelta();

  // Optional updates if your World/Rooms expose them:
  if (world && typeof world.update === 'function') world.update(dt, { state, isPaused, player, input, controls, mods, spawnProtectedTime });
  if (rooms && typeof rooms.update === 'function') rooms.update(dt);

  // --- AUTOFIRE support: call tryShoot while holding LMB for auto weapons ---
  if (state === State.RUN && !isPaused && mouseDownLeft) {
    const w = weapons[currentWeaponKey];
    if (w && w.auto) {
      tryShoot();
    }
  }

  // --- INTERACT: consume interactPressed (E) in loop ---
  if (state === State.RUN && !isPaused && interactPressed) {
    if (rooms && typeof rooms.tryInteract === 'function') {
      rooms.tryInteract();
    }
    interactPressed = false;
  }

  // Minimal local movement fallback (guarded by allowFallbackMove)
  if (state === State.RUN && !isPaused && allowFallbackMove) {
    const moveSpeed = (player.baseSpeed * (1 + (mods.haste || 0))) * dt;
    let forward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    let right = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    if (forward || right) {
      const len = Math.hypot(forward, right);
      if (len > 0) { forward /= len; right /= len; }
      controls.moveForward(forward * moveSpeed);
      controls.moveRight(right * moveSpeed);
    }
  }

  // Tick spawn protection
  if (spawnProtectedTime > 0) {
    spawnProtectedTime = Math.max(0, spawnProtectedTime - dt);
    if (protectedBadge) protectedBadge.style.display = spawnProtectedTime > 0 ? 'inline-block' : 'none';
  }

  // Tick timed mods
  if (modTimers.damageMult > 0) { modTimers.damageMult -= dt; if (modTimers.damageMult <= 0) mods.damageMult = 1.0; }
  if (modTimers.fireRateMult > 0) { modTimers.fireRateMult -= dt; if (modTimers.fireRateMult <= 0) mods.fireRateMult = 1.0; }
  if (modTimers.critChance > 0) { modTimers.critChance -= dt; if (modTimers.critChance <= 0) mods.critChance = 0.0; }
  if (modTimers.armorMult > 0) { modTimers.armorMult -= dt; if (modTimers.armorMult <= 0) mods.armorMult = 1.0; }
  if (modTimers.haste > 0) { modTimers.haste -= dt; if (modTimers.haste <= 0) mods.haste = 0.0; }
  if (mods.shieldTime > 0) { mods.shieldTime = Math.max(0, mods.shieldTime - dt); }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ==============================
// UI wiring (buttons that don't depend on bootstrap objects)
// ==============================
startRunBtn && startRunBtn.addEventListener('click', () => startRun());
resumeBtn && resumeBtn.addEventListener('click', () => { setPaused(false); try { controls.lock(); } catch {} });
restartBtn && restartBtn.addEventListener('click', () => endRunToHome());
toHomeBtn && toHomeBtn.addEventListener('click', () => endRunToHome());
startAgainBtn && startAgainBtn.addEventListener('click', () => { if (home) home.style.display = 'none'; startRun(); });

// ==============================
// Bootstrap: no top-level await
// ==============================
(async function bootstrap() {
  if (home) home.style.display = 'grid';
  renderShop();

  assets = new Assets(sound.ctx);
  await assets.loadAll(ASSET_MANIFEST); // empty manifest is fine

  world = new World(scene, assets);
  rooms = new RoomManager(world, null, (kind) => applyPickup(kind), assets);
  rooms.setTeleport((dest) => controls.getObject().position.copy(dest));

  // Let world know player height
  if (world) world.playerHeight = player.height;

  // Build first-person weapons
  buildGunModels();

  updateWeaponsUI(); showOnlyGun(currentWeaponKey);

  resize();
  requestAnimationFrame(loop);
})();