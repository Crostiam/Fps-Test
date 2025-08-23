import * as THREE from 'three';

const tmpVec3 = new THREE.Vector3();
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function segmentPointDistance(a, b, p, outClosest = null) {
  const ab = tmpVecA.copy(b).sub(a);
  const ap = tmpVecB.copy(p).sub(a);
  const abLen2 = Math.max(1e-8, ab.lengthSq());
  let t = ap.dot(ab) / abLen2;
  t = clamp01(t);
  if (outClosest) outClosest.copy(a).addScaledVector(ab, t);
  return tmpVecB.copy(a).addScaledVector(ab, t).sub(p).length();
}

export class World {
  constructor(scene) {
    this.scene = scene;

    // Groups
    this.fxGroup = new THREE.Group();
    this.projectileGroup = new THREE.Group();
    this.targetGroup = new THREE.Group();
    this.enemyGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.rockGroup = new THREE.Group();
    this.houseGroup = new THREE.Group();
    this.powerupGroup = new THREE.Group();
    this.goldGroup = new THREE.Group();
    this.portalGroup = new THREE.Group();
    this.lairGroup = new THREE.Group();

    this.scene.add(
      this.targetGroup, this.enemyGroup, this.wallGroup, this.rockGroup,
      this.houseGroup, this.projectileGroup, this.fxGroup, this.powerupGroup,
      this.goldGroup, this.portalGroup, this.lairGroup
    );

    // Data
    this.targets = [];
    this.enemies = [];
    this.obstacles = [];
    this.projectiles = [];
    this.houses = [];
    this.noSpawnVolumes = [];
    this.portals = [];
    this.floor = 1;
    this.difficulty = 1;
    this.activeBoss = null;
    this.activeBossKind = null;

    // Setup
    this._setupLights();
    this._setupFloor();
    this._buildArenaWalls();
    this._setupHouses();
    this._buildLairs();
    this._scatterRocks(80);
    this._setupAmbientObstacles();

    this.spawnTargets(12);
    this.spawnEnemies({ melee: 5, ranged: 3 });
    this.spawnPowerups(10);

    // Boss for current floor
    this._spawnRandomBossForFloor();

    this.ray = new THREE.Raycaster();
  }

  startFloor(floor) {
    this.floor = floor;
    this.difficulty = 1 + (floor - 1) * 0.35;
    this.resetDynamic(false);
    this.spawnTargets(12);
    const baseMelee = 5 + Math.floor((floor - 1) * 1.5);
    const baseRanged = 3 + Math.floor((floor - 1) * 1.0);
    this.spawnEnemies({ melee: baseMelee, ranged: baseRanged });
    this.spawnPowerups(10);
    this._spawnRandomBossForFloor();
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202028, 0.55);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 14, 6);
    this.scene.add(hemi, dir);
  }
  _setupFloor() {
    const geo = new THREE.PlaneGeometry(260, 260);
    const mat = new THREE.MeshStandardMaterial({ color: 0x252a32, metalness: 0.1, roughness: 0.95 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'floor';
    this.scene.add(floor);
    const grid = new THREE.GridHelper(260, 52, 0x444a56, 0x2a2f3a);
    this.scene.add(grid);
  }
  _buildArenaWalls() {
    const h = 6, t = 0.6, L = 240;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9, metalness: 0.05 });
    const makeWall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h/2, z);
      m.name = 'arena_wall';
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      this.wallGroup.add(m);
      this.obstacles.push(m);
    };
    makeWall(L, t, 0, -L/2 + t/2);
    makeWall(L, t, 0,  L/2 - t/2);
    makeWall(t, L, -L/2 + t/2, 0);
    makeWall(t, L,  L/2 - t/2, 0);
  }
  _setupHouses() {
    const makeHouse = (cx, cz, size = 10, height = 3.2, doorWidth = 2.2, wallT = 0.3, rotY = 0) => {
      const group = new THREE.Group();
      group.position.set(cx, 0, cz);
      group.rotation.y = rotY;
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.85, metalness: 0.05 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.9, metalness: 0.02 });
      const half = size/2, segY = height/2;

      const makeWallSeg = (w, h, d, x, y, z) => {
        const wMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        wMesh.position.set(x, y, z);
        wMesh.name = 'house_wall';
        wMesh.userData.aabb = new THREE.Box3().setFromObject(wMesh);
        wMesh.userData.static = true;
        group.add(wMesh);
        this.obstacles.push(wMesh);
      };
      const frontZ = -half + wallT/2;
      const sideW = (size - doorWidth) / 2;
      makeWallSeg(sideW, height, wallT, -(doorWidth/2 + sideW/2), segY, frontZ);
      makeWallSeg(sideW, height, wallT,  (doorWidth/2 + sideW/2), segY, frontZ);
      makeWallSeg(size, height, wallT, 0, segY, half - wallT/2);
      makeWallSeg(wallT, height, size, -half + wallT/2, segY, 0);
      makeWallSeg(wallT, height, size,  half - wallT/2, segY, 0);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(size, wallT, size), roofMat);
      roof.position.set(0, height + wallT/2, 0);
      roof.name = 'house_roof';
      group.add(roof);

      this.houseGroup.add(group);
      this.houses.push({ group, size, height, wallT });
    };
    makeHouse(-18, -12, 10, 3.2, 2.2, 0.3, 0);
    makeHouse(14, 16, 12, 3.5, 2.6, 0.3, Math.PI * 0.25);
    makeHouse(-8, 18, 9, 3.0, 2.0, 0.3, -Math.PI * 0.2);
  }
  _buildLairs() {
    while (this.lairGroup.children.length) this.lairGroup.remove(this.lairGroup.children[0]);
    this.castle = this._buildCastle(0, -85, 36, 0.8, 6.5);
    this.pyramid = this._buildPyramid(-90, 40, 30, 8);
    this.icecave = this._buildIceCave(85, -30, 34, 7);
  }
  _buildCastle(cx, cz, size, wallT, height) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x333845, roughness: 0.9, metalness: 0.05 });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x2f3440, roughness: 0.95, metalness: 0.04 });
    const group = new THREE.Group(); group.position.set(cx, 0, cz);
    const addWall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      m.name = 'castle_wall';
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      group.add(m); this.obstacles.push(m);
    };
    const half = size/2, gateW = 4, sideW = (size - gateW) / 2;
    addWall(sideW, height, wallT, -(gateW/2 + sideW/2), height/2, -half + wallT/2);
    addWall(sideW, height, wallT,  (gateW/2 + sideW/2), height/2, -half + wallT/2);
    addWall(size, height, wallT, 0, height/2,  half - wallT/2);
    addWall(wallT, height, size, -half + wallT/2, height/2, 0);
    addWall(wallT, height, size,  half - wallT/2, height/2, 0);
    const towerR = 2.2, towerH = 8, towerGeo = new THREE.CylinderGeometry(towerR, towerR, towerH, 12);
    const towerPos = [
      [-half + towerR + wallT, towerH/2, -half + towerR + wallT],
      [ half - towerR - wallT, towerH/2, -half + towerR + wallT],
      [-half + towerR + wallT, towerH/2,  half - towerR - wallT],
      [ half - towerR - wallT, towerH/2,  half - towerR - wallT],
    ];
    for (const [x,y,z] of towerPos) {
      const t = new THREE.Mesh(towerGeo, towerMat);
      t.position.set(x,y,z);
      t.name = 'castle_tower';
      t.userData.aabb = new THREE.Box3().setFromObject(t);
      t.userData.static = true;
      group.add(t); this.obstacles.push(t);
    }
    this.lairGroup.add(group);
    const courtyard = new THREE.Box3(
      new THREE.Vector3(cx - half + wallT, 0, cz - half + wallT),
      new THREE.Vector3(cx + half - wallT, height, cz + half - wallT)
    );
    this.noSpawnVolumes.push(courtyard);
    return { group, center: new THREE.Vector3(cx, 0, cz), size, wallT, height };
  }
  _buildPyramid(cx, cz, size, height) {
    const group = new THREE.Group(); group.position.set(cx, 0, cz);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b6b3f, roughness: 0.95, metalness: 0.03 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(size, 2, size), mat);
    base.position.set(0, 1, 0); base.name = 'pyramid_base';
    group.add(base); base.userData.aabb = new THREE.Box3().setFromObject(base); base.userData.static = true; this.obstacles.push(base);
    const sideT = 0.8, half = size/2;
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xa3844d, roughness: 0.95, metalness: 0.02 });
    const sideW = size, sideH = height, sideD = sideT;
    const sides = [
      [0, height/2 + 2, -half + sideT/2, 0],
      [0, height/2 + 2,  half - sideT/2, 0],
      [-half + sideT/2, height/2 + 2, 0, Math.PI/2],
      [ half - sideT/2, height/2 + 2, 0, Math.PI/2],
    ];
    for (const [x,y,z,ry] of sides) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(sideW, sideH, sideD), sideMat);
      s.position.set(x,y,z); s.rotation.y = ry || 0; s.name='pyramid_wall';
      group.add(s); s.userData.aabb = new THREE.Box3().setFromObject(s); s.userData.static = true; this.obstacles.push(s);
    }
    this.lairGroup.add(group);
    const inner = new THREE.Box3(
      new THREE.Vector3(cx - half + sideT, 0, cz - half + sideT),
      new THREE.Vector3(cx + half - sideT, height + 2, cz + half - sideT)
    );
    this.noSpawnVolumes.push(inner);
    return { group, center: new THREE.Vector3(cx, 0, cz), size, height };
  }
  _buildIceCave(cx, cz, size, height) {
    const group = new THREE.Group(); group.position.set(cx, 0, cz);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4a6b, roughness: 0.95, metalness: 0.04 });
    const half = size/2, t = 0.8;
    const addWall = (w,h,d,x,y,z) => {
      const wMesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat);
      wMesh.position.set(x,y,z); wMesh.name='ice_wall';
      group.add(wMesh); wMesh.userData.aabb = new THREE.Box3().setFromObject(wMesh); wMesh.userData.static = true; this.obstacles.push(wMesh);
    };
    addWall(size, height, t, 0, height/2, -half + t/2);
    addWall(size, height, t, 0, height/2,  half - t/2);
    addWall(t, height, size, -half + t/2, height/2, 0);
    addWall(t, height, size,  half - t/2, height/2, 0);
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x1e3a8a, emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.6 });
    for (let i=0;i<6;i++){
      const r = 0.6 + Math.random()*1.2;
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, r*3, 6), crystalMat);
      m.position.set((Math.random()-0.5)*(size-6), r*1.5, (Math.random()-0.5)*(size-6));
      m.name='ice_crystal'; group.add(m);
      m.userData.aabb = new THREE.Box3().setFromObject(m); m.userData.static = true; this.obstacles.push(m);
    }
    this.lairGroup.add(group);
    const inner = new THREE.Box3(
      new THREE.Vector3(cx - half + t, 0, cz - half + t),
      new THREE.Vector3(cx + half - t, height, cz + half - t)
    );
    this.noSpawnVolumes.push(inner);
    return { group, center: new THREE.Vector3(cx,0,cz), size, height };
  }

  _setupAmbientObstacles() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x44597a, metalness: 0.05, roughness: 0.8 });
    const geo = new THREE.BoxGeometry(4, 4, 4);
    const positions = [[8,2,-8], [-10,2,-15], [15,2,12], [-12,2,10], [0,2,18], [18,2,0]];
    for (const [x,y,z] of positions) {
      const p = new THREE.Vector3(x,y,z);
      if (this._pointInsideAnyInterior(p) || this._pointInsideAnyNoSpawn(p)) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      m.name = 'obstacle';
      this.scene.add(m);
      this.obstacles.push(m);
    }
  }

  _pointInsideAnyNoSpawn(p) {
    for (const box of this.noSpawnVolumes) if (box.containsPoint(p)) return true;
    return false;
  }
  _pointInsideAnyInterior(worldPoint) {
    for (const h of this.houses) {
      const p = worldPoint.clone();
      h.group.worldToLocal(p);
      const half = h.size/2;
      const minX = -half + h.wallT, maxX = half - h.wallT;
      const minZ = -half + h.wallT, maxZ = half - h.wallT;
      const minY = 0, maxY = h.height;
      if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ && p.y >= minY && p.y <= maxY) return true;
    }
    return false;
  }

  getSpawnPointInsideHouse() {
    if (this.houses.length === 0) return new THREE.Vector3(0, 1.7, 0);
    const h = this.houses[Math.floor(Math.random()*this.houses.length)];
    const half = h.size/2;
    const local = new THREE.Vector3(
      (Math.random()*0.4 - 0.2) * (h.size - 2*h.wallT),
      0,
      Math.random()*((half - h.wallT - 1.2)) - (half - h.wallT - 1.2)/2
    );
    const world = local.clone();
    h.group.localToWorld(world);
    world.y = 1.7;
    return world;
  }

  _randAway(range=180) {
    let p = new THREE.Vector3();
    let tries=0;
    do {
      p.set((Math.random()-0.5)*range, 0, (Math.random()-0.5)*range);
      tries++;
    } while ((this._pointInsideAnyInterior(p) || this._pointInsideAnyNoSpawn(p)) && tries < 40);
    return p;
  }

  _scatterRocks(n = 80) {
    const colors = [0x6b6f7a, 0x545962, 0x3f4450];
    let placed = 0, attempts = 0;
    while (placed < n && attempts < n * 20) {
      attempts++;
      const r = 0.7 + Math.random() * 2.0;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random()*colors.length)],
        roughness: 0.95, metalness: 0.02
      });
      const rock = new THREE.Mesh(geo, mat);
      const pos = this._randAway(220);
      if (this._pointInsideAnyInterior(pos) || this._pointInsideAnyNoSpawn(pos)) continue;
      rock.position.set(pos.x, r * 0.5, pos.z);
      rock.rotation.set(Math.random()*0.3, Math.random()*Math.PI, Math.random()*0.3);
      rock.name = 'rock';
      rock.userData.aabb = new THREE.Box3().setFromObject(rock);
      rock.userData.static = true;
      this.rockGroup.add(rock);
      this.obstacles.push(rock);
      placed++;
    }
  }

  spawnTargets(count = 10) {
    const geo = new THREE.SphereGeometry(0.7, 12, 12);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.6, 0.6),
        metalness: 0.2,
        roughness: 0.5
      });
      const t = new THREE.Mesh(geo, mat);
      const p = this._randAway(200);
      t.position.set(p.x, 1 + Math.random()*6, p.z);
      t.userData = {
        type: 'target',
        health: 1,
        baseY: t.position.y,
        bobPhase: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1)
      };
      this.targetGroup.add(t);
      this.targets.push(t);
    }
  }

  spawnEnemies({ melee = 4, ranged = 2 } = {}) {
    const healthScale = this.difficulty;
    const speedScale = 1 + (this.floor - 1) * 0.05;
    const spawnOne = (kind) => {
      const h = 2.0;
      const geo = new THREE.BoxGeometry(1, h, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: kind === 'ranged' ? 0x9b59b6 : 0xd9534f,
        metalness: 0.1,
        roughness: 0.7
      });
      const e = new THREE.Mesh(geo, mat);
      const pos = this._randAway(200);
      e.position.set(pos.x, h*0.5, pos.z);
      e.userData = {
        type: 'enemy',
        kind,
        health: Math.round(3 * healthScale),
        speed: (kind === 'ranged' ? 2.4 : 3.0) * speedScale * (0.9 + Math.random()*0.3),
        radius: 0.5,
        height: h,
        shootCooldown: 0,
        phase: Math.random() * Math.PI * 2
      };
      this.enemyGroup.add(e);
      this.enemies.push(e);
    };
    for (let i = 0; i < melee; i++) spawnOne('melee');
    for (let i = 0; i < ranged; i++) spawnOne('ranged');
  }

  spawnPowerups(n = 8) {
    const kinds = ['health', 'shield', 'damage', 'firerate', 'weapon_rifle', 'weapon_shotgun'];
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const mesh = this._makePowerupMesh(kind);
      const pos = this._randAway(200);
      mesh.position.set(pos.x, 0.6, pos.z);
      mesh.userData = { type: 'powerup', kind, spin: Math.random()*Math.PI*2 };
      this.powerupGroup.add(mesh);
    }
  }
  _makePowerupMesh(kind) {
    const color = {
      health: 0x4ade80, shield: 0x60a5fa, damage: 0xf59e0b, firerate: 0xf472b6,
      weapon_rifle: 0x9ca3af, weapon_shotgun: 0xef4444
    }[kind] || 0xffffff;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 });
    return new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat);
  }

  _spawnRandomBossForFloor() {
    const options = ['castle', 'pyramid', 'ice'];
    const pick = options[Math.floor(Math.random()*options.length)];
    this._spawnBossFor(pick);
  }
  _spawnBossFor(kind) {
    if (this.activeBoss) return;
    const healthScale = 1 + (this.floor - 1) * 0.4;
    let pos = null, mesh = null, data = null, color = 0x8b5cf6, emissive = 0x5b21b6;
    if (kind === 'castle') {
      pos = this.castle.center.clone();
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12),
        new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6, emissive, emissiveIntensity: 0.2 }));
      mesh.position.set(pos.x, 1.6, pos.z);
      data = { pattern: 'bursts' };
    } else if (kind === 'pyramid') {
      pos = this.pyramid.center.clone();
      mesh = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.0, 8),
        new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.25, roughness: 0.6, emissive: 0x92400e, emissiveIntensity: 0.25 }));
      mesh.position.set(pos.x, 1.5, pos.z);
      data = { pattern: 'spread' };
    } else {
      pos = this.icecave.center.clone();
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0),
        new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.3, roughness: 0.5, emissive: 0x1d4ed8, emissiveIntensity: 0.3 }));
      mesh.position.set(pos.x, 1.4, pos.z);
      data = { pattern: 'rings' };
    }
    mesh.userData = {
      type: 'boss',
      kind,
      health: Math.round(60 * healthScale),
      speed: 2.0,
      radius: 1.0,
      height: 3.0,
      shootCooldown: 1.0,
      burstCooldown: 4.0,
      ...data
    };
    this.enemyGroup.add(mesh);
    this.enemies.push(mesh);
    this.activeBoss = mesh;
    this.activeBossKind = kind;
  }

  spawnProjectile(from, dir, speed, owner = 'player', ttl = 2.0, damage = 1) {
    const pos = from.clone();
    const vel = dir.clone().normalize().multiplyScalar(speed);
    const radius = 0.06;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 8),
      new THREE.MeshBasicMaterial({ color: owner === 'player' ? 0xffe066 : 0xbf5fff })
    );
    mesh.position.copy(pos);
    this.projectileGroup.add(mesh);
    this.projectiles.push({ pos, vel, ttl, radius, owner, damage, mesh });
  }

  spawnGold(point, amount = 1) {
    const geo = new THREE.IcosahedronGeometry(0.15, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(point); m.position.y = Math.max(m.position.y, 0.5);
    m.userData = { type: 'gold', amount, ttl: 12, spin: Math.random()*Math.PI*2 };
    this.goldGroup.add(m);
  }

  spawnPortal(point) {
    const ringGeo = new THREE.TorusGeometry(0.9, 0.08, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x86efac, emissive: 0x16a34a, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.4 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(point); ring.position.y = 1.2;
    ring.rotation.x = Math.PI/2;
    ring.userData = { type: 'portal', spin: 0 };
    this.portalGroup.add(ring);
    this.portals.push(ring);
  }

  update(dt, playerPos = null, onPlayerHit = null, onEnemyShot = null, playerVulnerable = true) {
    // Animate powerups/gold/portal
    for (const p of this.powerupGroup.children) {
      p.userData.spin += dt;
      p.rotation.y = p.userData.spin;
      p.position.y = 0.6 + Math.sin(p.userData.spin*2.0)*0.08;
    }
    for (let i = this.goldGroup.children.length-1; i>=0; i--) {
      const g = this.goldGroup.children[i];
      g.userData.ttl -= dt;
      g.userData.spin += dt*4;
      g.rotation.y = g.userData.spin;
      if (g.userData.ttl <= 0) {
        if (g.geometry && g.geometry.dispose) g.geometry.dispose();
        if (g.material) {
          if (Array.isArray(g.material)) g.material.forEach(m => m && m.dispose && m.dispose());
          else if (g.material.dispose) g.material.dispose();
        }
        this.goldGroup.remove(g);
      }
    }
    for (const r of this.portalGroup.children) {
      r.userData.spin += dt;
      r.rotation.z = r.userData.spin;
    }

    // Targets bob
    for (const t of this.targets) {
      t.rotation.y += t.userData.rotSpeed * dt;
      t.position.y = t.userData.baseY + Math.sin(t.userData.bobPhase += dt * 2.0) * 0.25;
    }

    // Enemies (incl. bosses)
    if (playerPos) {
      for (const e of this.enemies) {
        const isBoss = e.userData.type === 'boss';
        const kind = isBoss ? 'boss' : e.userData.kind;
        tmpVecA.set(playerPos.x, e.position.y, playerPos.z).sub(e.position); tmpVecA.y = 0;
        const dist = tmpVecA.length(); if (dist > 0.001) tmpVecA.normalize();

        if (!isBoss) {
          if (kind === 'melee') {
            e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
          } else {
            const min = 12, max = 24;
            if (dist < min) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
            else if (dist > max) e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
            else {
              const perp = tmpVecB.set(-tmpVecA.z, 0, tmpVecA.x).normalize();
              const s = Math.sin(performance.now()*0.001 + e.userData.phase) * 0.6;
              e.position.addScaledVector(perp, s * dt * e.userData.speed);
            }
            e.userData.shootCooldown -= dt;
            if (playerVulnerable && e.userData.shootCooldown <= 0 && onEnemyShot) {
              const from = e.position.clone().setY(e.position.y + 0.8);
              const dir = playerPos.clone().sub(from).normalize();
              this.ray.set(from, dir); this.ray.far = 60;
              const hits = this.ray.intersectObjects(this.obstacles, true);
              const clear = !hits[0] || hits[0].distance > from.distanceTo(playerPos);
              if (clear) {
                const dmg = Math.round(6 * this.difficulty);
                this.spawnProjectile(from, dir, 42, 'enemy', 2.0, dmg);
                onEnemyShot();
                e.userData.shootCooldown = 1.1 + Math.random()*0.6;
              } else e.userData.shootCooldown = 0.3 + Math.random()*0.4;
            }
          }
        } else {
          const patt = e.userData.pattern;
          const min = (patt === 'spread') ? 14 : (patt === 'rings') ? 16 : 18;
          const max = (patt === 'spread') ? 26 : (patt === 'rings') ? 28 : 32;
          if (dist < min) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
          else if (dist > max) e.position.addScaledVector(tmpVecA, e.userData.speed * dt);

          if (patt === 'bursts' || patt === 'spread') {
            e.userData.shootCooldown -= dt;
            if (playerVulnerable && e.userData.shootCooldown <= 0 && onEnemyShot) {
              const from = e.position.clone().setY(e.position.y + (patt === 'bursts' ? 1.2 : 1.0));
              if (patt === 'bursts') {
                const dir = playerPos.clone().sub(from).normalize();
                const dmg = Math.round(10 * this.difficulty);
                this.spawnProjectile(from, dir, 55, 'enemy', 2.5, dmg);
                onEnemyShot(); e.userData.shootCooldown = 0.9 + Math.random()*0.5;
              } else {
                for (let i=-2;i<=2;i++){
                  const dir = playerPos.clone().sub(from).normalize();
                  const yaw = i * 0.08;
                  const rot = new THREE.Matrix4().makeRotationY(yaw);
                  dir.applyMatrix4(rot).normalize();
                  const dmg = Math.round(6 * this.difficulty);
                  this.spawnProjectile(from, dir, 48, 'enemy', 2.2, dmg);
                }
                onEnemyShot(); e.userData.shootCooldown = 1.2 + Math.random()*0.5;
              }
            }
          }
          e.userData.burstCooldown -= dt;
          if (patt !== 'spread' && playerVulnerable && e.userData.burstCooldown <= 0 && onEnemyShot) {
            const from = e.position.clone().setY(e.position.y + 0.9);
            const bullets = 18;
            for (let i=0;i<bullets;i++){
              const ang = (i / bullets) * Math.PI * 2;
              const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
              const dmg = Math.round(5 * this.difficulty);
              this.spawnProjectile(from, dir, 30, 'enemy', 3.0, dmg);
            }
            onEnemyShot(); e.userData.burstCooldown = 3.8 + Math.random()*1.2;
          }
        }

        const nextPos = e.position.clone();
        this.resolveCollisions(nextPos, e.userData.radius, e.userData.height);
        e.position.copy(nextPos);
      }
    }

    // Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const start = p.pos.clone();
      const delta = tmpVec3.copy(p.vel).multiplyScalar(dt);
      const end = start.clone().add(delta);
      this.ray.set(start, delta.clone().normalize());
      this.ray.far = delta.length() + 0.001;

      let hit = null;
      if (p.owner === 'player') {
        const colliders = [...this.obstacles, ...this.enemyGroup.children, ...this.targetGroup.children];
        const hits = this.ray.intersectObjects(colliders, true);
        hit = hits[0] || null;
        if (hit) {
          this._spawnTracer(start, hit.point, 0xffe066, 0.06);
          const kind = hit.object.userData?.type;
          if (kind === 'enemy' || kind === 'target' || kind === 'boss') {
            this.handleHit(hit, p.damage);
          }
          this._removeProjectileAt(i);
          continue;
        }
      } else {
        const hits = this.ray.intersectObjects(this.obstacles, true);
        hit = hits[0] || null;
        if (hit) {
          this._spawnTracer(start, hit.point, 0xbf5fff, 0.06);
          this._removeProjectileAt(i);
          continue;
        }
      }

      p.pos.copy(end);
      p.mesh.position.copy(p.pos);
      p.ttl -= dt;
      if (p.ttl <= 0) { this._removeProjectileAt(i); continue; }
    }

    // FX fade
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const l = this.fxGroup.children[i];
      l.userData.ttl -= dt;
      const a = Math.max(0, l.userData.ttl / l.userData.maxTtl);
      l.material.opacity = a;
      if (l.userData.ttl <= 0) {
        if (l.geometry && l.geometry.dispose) l.geometry.dispose();
        if (l.material && l.material.dispose) l.material.dispose();
        this.fxGroup.remove(l);
      }
    }
  }

  _spawnTracer(from, to, color = 0xffe066, ttl = 0.08) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    line.userData.ttl = ttl; line.userData.maxTtl = ttl;
    this.fxGroup.add(line);
  }
  _removeProjectileAt(i) {
    const p = this.projectiles[i];
    if (p.mesh) {
      if (p.mesh.geometry && p.mesh.geometry.dispose) p.mesh.geometry.dispose();
      if (p.mesh.material) {
        if (Array.isArray(p.mesh.material)) p.mesh.material.forEach(m=>m && m.dispose && m.dispose());
        else if (p.mesh.material.dispose) p.mesh.material.dispose();
      }
      this.projectileGroup.remove(p.mesh);
    }
    this.projectiles.splice(i, 1);
  }

  handleHit(intersection, damage = 1) {
    const obj = intersection.object;
    if (obj.userData?.type === 'target') {
      obj.userData.health -= damage;
      this.spawnGold(intersection.point, 1);
      if (obj.userData.health <= 0) {
        this.targetGroup.remove(obj);
        this.targets = this.targets.filter(t => t !== obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose());
          else if (obj.material.dispose) obj.material.dispose();
        }
        this.spawnTargets(1);
        for (let i=0;i<2;i++) this.spawnGold(intersection.point.clone().add(new THREE.Vector3((Math.random()-0.5)*0.6, 0, (Math.random()-0.5)*0.6)), 1);
        return { removed: true, kind: 'target', score: 1 };
      }
      return { removed: false, kind: 'target', score: 0 };
    }
    if (obj.userData?.type === 'enemy') {
      obj.userData.health -= damage;
      const mat = obj.material; if (mat && mat.color) {
        const oldColor = mat.color.clone();
        mat.color.setHex(0xff7770); setTimeout(() => { if (mat && mat.color) mat.color.copy(oldColor); }, 80);
      }
      if (obj.userData.health <= 0) {
        for (let i=0;i<3;i++) this.spawnGold(intersection.point.clone().add(new THREE.Vector3((Math.random()-0.5)*0.8, 0, (Math.random()-0.5)*0.8)), 2);
        this.enemyGroup.remove(obj);
        this.enemies = this.enemies.filter(e => e !== obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose());
          else if (obj.material.dispose) obj.material.dispose();
        }
        this.spawnEnemies({ melee: obj.userData.kind === 'melee' ? 1 : 0, ranged: obj.userData.kind === 'ranged' ? 1 : 0 });
        return { removed: true, kind: 'enemy', score: 3 };
      }
      return { removed: false, kind: 'enemy', score: 0 };
    }
    if (obj.userData?.type === 'boss') {
      obj.userData.health -= damage;
      const mat = obj.material;
      if (mat) {
        const oldE = mat.emissiveIntensity || 0;
        mat.emissiveIntensity = 0.5;
        setTimeout(() => { if (mat) mat.emissiveIntensity = oldE; }, 80);
      }
      if (obj.userData.health <= 0) {
        for (let i=0;i<20;i++) this.spawnGold(intersection.point.clone().add(new THREE.Vector3((Math.random()-0.5)*2.2, 0, (Math.random()-0.5)*2.2)), 3);
        const where = obj.position.clone(); where.y = 0.1;
        this.spawnPortal(where);
        this.enemyGroup.remove(obj);
        this.enemies = this.enemies.filter(e => e !== obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose());
          else if (obj.material.dispose) obj.material.dispose();
        }
        this.activeBoss = null; this.activeBossKind = null;
        return { removed: true, kind: 'boss', score: 20 };
      }
      return { removed: false, kind: 'boss', score: 0 };
    }
    return { removed: false, kind: 'unknown', score: 0 };
  }

  resolveCollisions(nextPos, playerRadius = 0.6, playerHeight = 1.7) {
    for (const obs of this.obstacles) {
      const aabb = obs.userData.aabb; aabb.setFromObject(obs);
      const min = aabb.min, max = aabb.max;
      if (nextPos.y - playerHeight * 0.5 < max.y && nextPos.y + playerHeight * 0.5 > min.y) {
        const closestX = Math.max(min.x, Math.min(nextPos.x, max.x));
        const closestZ = Math.max(min.z, Math.min(nextPos.z, max.z));
        const dx = nextPos.x - closestX, dz = nextPos.z - closestZ;
        const distSq = dx*dx + dz*dz, r = playerRadius + 0.001;
        if (distSq < r*r) {
          const dist = Math.sqrt(distSq) || 0.0001, push = r - dist;
          tmpVec3.set(dx / dist, 0, dz / dist).multiplyScalar(push);
          nextPos.add(tmpVec3);
        }
      }
    }
  }

  checkPlayerPickups(playerPos, onPowerup, onGold) {
    for (let i = this.powerupGroup.children.length - 1; i >= 0; i--) {
      const p = this.powerupGroup.children[i];
      if (p.position.distanceTo(playerPos) < 1.3) {
        const kind = p.userData.kind;
        if (p.geometry && p.geometry.dispose) p.geometry.dispose();
        if (p.material) {
          if (Array.isArray(p.material)) p.material.forEach(m=>m && m.dispose && m.dispose());
          else if (p.material.dispose) p.material.dispose();
        }
        this.powerupGroup.remove(p);
        onPowerup(kind);
      }
    }
    for (let i = this.goldGroup.children.length - 1; i >= 0; i--) {
      const g = this.goldGroup.children[i];
      if (g.position.distanceTo(playerPos) < 1.2) {
        const amt = g.userData.amount || 1;
        if (g.geometry && g.geometry.dispose) g.geometry.dispose();
        if (g.material) {
          if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose());
          else if (g.material.dispose) g.material.dispose();
        }
        this.goldGroup.remove(g);
        onGold(amt);
      }
    }
  }

  checkPortalEntry(playerPos) {
    for (const r of this.portalGroup.children) {
      if (r.position.distanceTo(playerPos) < 1.6) return true;
    }
    return false;
  }

  clearPortals() {
    for (let i=this.portalGroup.children.length-1;i>=0;i--){
      const r = this.portalGroup.children[i];
      if (r.geometry && r.geometry.dispose) r.geometry.dispose();
      if (r.material) {
        if (Array.isArray(r.material)) r.material.forEach(m=>m && m.dispose && m.dispose());
        else if (r.material.dispose) r.material.dispose();
      }
      this.portalGroup.remove(r);
    }
    this.portals.length = 0;
  }

  resetDynamic(removePortals = true) {
    for (const t of this.targets) {
      this.targetGroup.remove(t);
      if (t.geometry && t.geometry.dispose) t.geometry.dispose();
      if (t.material) {
        if (Array.isArray(t.material)) t.material.forEach(m=>m && m.dispose && m.dispose());
        else if (t.material.dispose) t.material.dispose();
      }
    }
    this.targets.length = 0;

    for (const e of this.enemies) {
      this.enemyGroup.remove(e);
      if (e.geometry && e.geometry.dispose) e.geometry.dispose();
      if (e.material) {
        if (Array.isArray(e.material)) e.material.forEach(m=>m && m.dispose && m.dispose());
        else if (e.material.dispose) e.material.dispose();
      }
    }
    this.enemies.length = 0; this.activeBoss = null; this.activeBossKind = null;

    for (const p of this.projectiles) {
      if (p.mesh) {
        if (p.mesh.geometry && p.mesh.geometry.dispose) p.mesh.geometry.dispose();
        if (p.mesh.material) {
          if (Array.isArray(p.mesh.material)) p.mesh.material.forEach(m=>m && m.dispose && m.dispose());
          else if (p.mesh.material.dispose) p.mesh.material.dispose();
        }
        this.projectileGroup.remove(p.mesh);
      }
    }
    this.projectiles.length = 0;

    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const l = this.fxGroup.children[i];
      if (l.geometry && l.geometry.dispose) l.geometry.dispose();
      if (l.material && l.material.dispose) l.material.dispose();
      this.fxGroup.remove(l);
    }

    for (let i = this.powerupGroup.children.length - 1; i >= 0; i--) {
      const p = this.powerupGroup.children[i];
      if (p.geometry && p.geometry.dispose) p.geometry.dispose();
      if (p.material) {
        if (Array.isArray(p.material)) p.material.forEach(m=>m && m.dispose && m.dispose());
        else if (p.material.dispose) p.material.dispose();
      }
      this.powerupGroup.remove(p);
    }

    for (let i = this.goldGroup.children.length - 1; i >= 0; i--) {
      const g = this.goldGroup.children[i];
      if (g.geometry && g.geometry.dispose) g.geometry.dispose();
      if (g.material) {
        if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose());
        else if (g.material.dispose) g.material.dispose();
      }
      this.goldGroup.remove(g);
    }

    if (removePortals) this.clearPortals();
  }
}
