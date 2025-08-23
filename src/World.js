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
  const closest = tmpVecB.copy(a).addScaledVector(ab, t);
  if (outClosest) outClosest.copy(closest);
  return closest.sub(p).length();
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
    this.barrierGroup = new THREE.Group();

    this.scene.add(
      this.targetGroup, this.enemyGroup, this.wallGroup, this.rockGroup,
      this.houseGroup, this.projectileGroup, this.fxGroup, this.powerupGroup,
      this.goldGroup, this.portalGroup, this.lairGroup, this.barrierGroup
    );

    // Data
    this.targets = [];
    this.enemies = [];
    this.obstacles = []; // blocks movement & bullets
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

    // Boss now spawns only when entering boss room (via RoomManager)

    this.ray = new THREE.Raycaster();
  }

  startFloor(floor) {
    this.floor = floor;
    this.difficulty = 1 + (floor - 1) * 0.35;
    this.resetDynamic(true); // also clear portals
    this.spawnTargets(12);
    const baseMelee = 5 + Math.floor((floor - 1) * 1.5);
    const baseRanged = 3 + Math.floor((floor - 1) * 1.0);
    this.spawnEnemies({ melee: baseMelee, ranged: baseRanged });
    this.spawnPowerups(10);
    // Boss is spawned by RoomManager when entering boss room
  }

  // Scene setup
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
      t.position.set(x,y,z); t.name = 'castle_tower';
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

    const gateW = 5;
    const sideWHalf = (size - gateW) / 2;

    const northLeft = new THREE.Mesh(new THREE.BoxGeometry(sideWHalf, height, sideT), sideMat);
    northLeft.position.set(-(gateW/2 + sideWHalf/2), height/2 + 2, -half + sideT/2);
    northLeft.name='pyramid_wall'; group.add(northLeft);
    northLeft.userData.aabb = new THREE.Box3().setFromObject(northLeft); northLeft.userData.static = true; this.obstacles.push(northLeft);

    const northRight = new THREE.Mesh(new THREE.BoxGeometry(sideWHalf, height, sideT), sideMat);
    northRight.position.set( (gateW/2 + sideWHalf/2), height/2 + 2, -half + sideT/2);
    northRight.name='pyramid_wall'; group.add(northRight);
    northRight.userData.aabb = new THREE.Box3().setFromObject(northRight); northRight.userData.static = true; this.obstacles.push(northRight);

    const south = new THREE.Mesh(new THREE.BoxGeometry(size, height, sideT), sideMat);
    south.position.set(0, height/2 + 2,  half - sideT/2); south.name='pyramid_wall';
    group.add(south); south.userData.aabb = new THREE.Box3().setFromObject(south); south.userData.static = true; this.obstacles.push(south);

    const west = new THREE.Mesh(new THREE.BoxGeometry(sideT, height, size), sideMat);
    west.position.set(-half + sideT/2, height/2 + 2, 0); west.name='pyramid_wall';
    group.add(west); west.userData.aabb = new THREE.Box3().setFromObject(west); west.userData.static = true; this.obstacles.push(west);

    const east = new THREE.Mesh(new THREE.BoxGeometry(sideT, height, size), sideMat);
    east.position.set( half - sideT/2, height/2 + 2, 0); east.name='pyramid_wall';
    group.add(east); east.userData.aabb = new THREE.Box3().setFromObject(east); east.userData.static = true; this.obstacles.push(east);

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

    const gateW = 5;
    const sideW = (size - gateW) / 2;
    const northL = new THREE.Mesh(new THREE.BoxGeometry(sideW, height, t), wallMat);
    northL.position.set(-(gateW/2 + sideW/2), height/2, -half + t/2);
    northL.name='ice_wall'; group.add(northL);
    northL.userData.aabb = new THREE.Box3().setFromObject(northL); northL.userData.static = true; this.obstacles.push(northL);

    const northR = new THREE.Mesh(new THREE.BoxGeometry(sideW, height, t), wallMat);
    northR.position.set((gateW/2 + sideW/2), height/2, -half + t/2);
    northR.name='ice_wall'; group.add(northR);
    northR.userData.aabb = new THREE.Box3().setFromObject(northR); northR.userData.static = true; this.obstacles.push(northR);

    const south = new THREE.Mesh(new THREE.BoxGeometry(size, height, t), wallMat);
    south.position.set(0, height/2,  half - t/2); south.name='ice_wall';
    group.add(south); south.userData.aabb = new THREE.Box3().setFromObject(south); south.userData.static = true; this.obstacles.push(south);

    const west = new THREE.Mesh(new THREE.BoxGeometry(t, height, size), wallMat);
    west.position.set(-half + t/2, height/2, 0); west.name='ice_wall';
    group.add(west); west.userData.aabb = new THREE.Box3().setFromObject(west); west.userData.static = true; this.obstacles.push(west);

    const east = new THREE.Mesh(new THREE.BoxGeometry(t, height, size), wallMat);
    east.position.set( half - t/2, height/2, 0); east.name='ice_wall';
    group.add(east); east.userData.aabb = new THREE.Box3().setFromObject(east); east.userData.static = true; this.obstacles.push(east);

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
