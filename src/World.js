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

    this.targets = [];
    this.enemies = [];
    this.obstacles = []; // anything that blocks movement and bullets

    this.fxGroup = new THREE.Group();
    this.projectileGroup = new THREE.Group();
    this.targetGroup = new THREE.Group();
    this.enemyGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.rockGroup = new THREE.Group();
    this.houseGroup = new THREE.Group();
    this.scene.add(this.targetGroup, this.enemyGroup, this.wallGroup, this.rockGroup, this.houseGroup, this.projectileGroup, this.fxGroup);

    this._setupLights();
    this._setupFloor();
    this._buildArenaWalls();
    this._setupHouses();
    this._scatterRocks(60);
    this._setupObstacles(); // legacy cubes for variety

    this.spawnTargets(10);
    this.spawnEnemies({ melee: 4, ranged: 3 });

    this.ray = new THREE.Raycaster();
    this.projectiles = []; // {pos, vel, ttl, radius, owner:'player'|'enemy', mesh}
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202028, 0.55);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 14, 6);
    this.scene.add(hemi, dir);
  }

  _setupFloor() {
    const geo = new THREE.PlaneGeometry(220, 220, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x252a32, metalness: 0.1, roughness: 0.95 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    floor.name = 'floor';
    this.scene.add(floor);

    const grid = new THREE.GridHelper(220, 44, 0x444a56, 0x2a2f3a);
    this.scene.add(grid);
  }

  _buildArenaWalls() {
    const h = 6;
    const t = 0.6;
    const L = 220;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9, metalness: 0.05 });
    const makeWall = (w, d, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h/2, z);
      m.rotation.y = ry || 0;
      m.name = 'arena_wall';
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      this.wallGroup.add(m);
      this.obstacles.push(m);
    };
    // North/South
    makeWall(L, t, 0, -L/2 + t/2, 0);
    makeWall(L, t, 0,  L/2 - t/2, 0);
    // West/East
    makeWall(t, L, -L/2 + t/2, 0, 0);
    makeWall(t, L,  L/2 - t/2, 0, 0);
  }

  _setupObstacles() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x44597a, metalness: 0.05, roughness: 0.8 });
    const geo = new THREE.BoxGeometry(4, 4, 4);
    const positions = [
      [8, 2, -8], [-10, 2, -15], [15, 2, 12], [-12, 2, 10], [0, 2, 18], [18, 2, 0]
    ];
    for (const [x, y, z] of positions) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      m.name = 'obstacle';
      this.scene.add(m);
      this.obstacles.push(m);
    }
  }

  _setupHouses() {
    const makeHouse = (cx, cz, size = 10, height = 3.2, doorWidth = 2.2, wallT = 0.3, rotY = 0) => {
      const group = new THREE.Group();
      group.position.set(cx, 0, cz);
      group.rotation.y = rotY;

      const wallMat = new THREE.MeshStandardMaterial({ color: 0x373d4a, roughness: 0.85, metalness: 0.05 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.9, metalness: 0.02 });

      const half = size/2;
      const segY = height/2;

      const makeWallSeg = (w, h, d, x, y, z) => {
        const wMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        wMesh.position.set(x, y, z);
        wMesh.name = 'house_wall';
        wMesh.userData.aabb = new THREE.Box3().setFromObject(wMesh);
        wMesh.userData.static = true;
        group.add(wMesh);
        this.obstacles.push(wMesh);
      };

      // Front wall split for doorway
      const frontZ = -half + wallT/2;
      const sideW = (size - doorWidth) / 2;
      makeWallSeg(sideW, height, wallT, - (doorWidth/2 + sideW/2), segY, frontZ);
      makeWallSeg(sideW, height, wallT,   (doorWidth/2 + sideW/2), segY, frontZ);

      // Back wall
      makeWallSeg(size, height, wallT, 0, segY, half - wallT/2);

      // Left/right walls
      makeWallSeg(wallT, height, size, -half + wallT/2, segY, 0);
      makeWallSeg(wallT, height, size,  half - wallT/2, segY, 0);

      // Roof (visual only)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(size, wallT, size), roofMat);
      roof.position.set(0, height + wallT/2, 0);
      roof.name = 'house_roof';
      group.add(roof);

      this.houseGroup.add(group);
    };

    makeHouse(-18, -12, 10, 3.2, 2.2, 0.3, 0);
    makeHouse(14, 16, 12, 3.5, 2.6, 0.3, Math.PI * 0.25);
    makeHouse(-8, 18, 9, 3.0, 2.0, 0.3, -Math.PI * 0.2);
  }

  _scatterRocks(n = 40) {
    const colors = [0x6b6f7a, 0x545962, 0x3f4450];
    for (let i = 0; i < n; i++) {
      const r = 0.7 + Math.random() * 2.0;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random()*colors.length)],
        roughness: 0.95, metalness: 0.02
      });
      const rock = new THREE.Mesh(geo, mat);
      const radius = 15 + Math.random() * 85;
      const angle = Math.random() * Math.PI * 2;
      rock.position.set(Math.cos(angle) * radius, r * 0.5, Math.sin(angle) * radius);
      rock.rotation.set(Math.random()*0.3, Math.random()*Math.PI, Math.random()*0.3);
      rock.name = 'rock';
      rock.userData.aabb = new THREE.Box3().setFromObject(rock);
      rock.userData.static = true;
      this.rockGroup.add(rock);
      this.obstacles.push(rock);
    }
  }

  spawnTargets(count = 10) {
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.6, 0.6),
        metalness: 0.2,
        roughness: 0.5
      });
      const cube = new THREE.Mesh(geo, mat);
      cube.position.set(
        (Math.random() - 0.5) * 120,
        1 + Math.random() * 6,
        (Math.random() - 0.5) * 120
      );
      cube.userData = {
        type: 'target',
        health: 1,
        baseY: cube.position.y,
        bobPhase: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1)
      };
      this.targetGroup.add(cube);
      this.targets.push(cube);
    }
  }

  spawnEnemies({ melee = 4, ranged = 2 } = {}) {
    const spawnOne = (kind) => {
      const h = 2.0;
      const geo = new THREE.BoxGeometry(1, h, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: kind === 'ranged' ? 0x9b59b6 : 0xd9534f,
        metalness: 0.1,
        roughness: 0.7
      });
      const enemy = new THREE.Mesh(geo, mat);
      enemy.position.set(
        (Math.random() - 0.5) * 160,
        h * 0.5,
        (Math.random() - 0.5) * 160
      );
      enemy.userData = {
        type: 'enemy',
        kind,
        health: 3,
        speed: kind === 'ranged' ? 2.3 + Math.random() * 0.9 : 2.8 + Math.random() * 1.2,
        radius: 0.5,
        height: h,
        shootCooldown: 0,
        phase: Math.random() * Math.PI * 2
      };
      this.enemyGroup.add(enemy);
      this.enemies.push(enemy);
    };

    for (let i = 0; i < melee; i++) spawnOne('melee');
    for (let i = 0; i < ranged; i++) spawnOne('ranged');
  }

  spawnProjectile(from, dir, speed, owner = 'player', ttl = 2.0) {
    const pos = from.clone();
    const vel = dir.clone().normalize().multiplyScalar(speed);
    const radius = owner === 'player' ? 0.06 : 0.06;

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 8),
      new THREE.MeshBasicMaterial({ color: owner === 'player' ? 0xffe066 : 0xbf5fff })
    );
    mesh.position.copy(pos);
    this.projectileGroup.add(mesh);

    this.projectiles.push({ pos, vel, ttl, radius, owner, mesh });
  }

  _spawnTracer(from, to, color = 0xffe066, ttl = 0.08) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    line.userData.ttl = ttl;
    line.userData.maxTtl = ttl;
    this.fxGroup.add(line);
  }

  update(dt, playerPos = null, onPlayerHit = null, onEnemyShot = null, playerVulnerable = true) {
    // Targets idle motion
    for (const t of this.targets) {
      t.rotation.y += t.userData.rotSpeed * dt;
      t.position.y = t.userData.baseY + Math.sin(t.userData.bobPhase += dt * 2.0) * 0.25;
    }

    // Enemies
    if (playerPos) {
      for (const e of this.enemies) {
        const kind = e.userData.kind;
        // Horizontal vector to player
        tmpVecA.set(playerPos.x, e.position.y, playerPos.z).sub(e.position);
        tmpVecA.y = 0;
        const dist = tmpVecA.length();
        if (dist > 0.001) tmpVecA.normalize();

        if (kind === 'melee') {
          e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
        } else {
          // Ranged: keep distance, light strafing
          const min = 12, max = 24;
          if (dist < min) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
          else if (dist > max) e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
          else {
            // strafe perpendicular with stable phase
            const perp = tmpVecB.set(-tmpVecA.z, 0, tmpVecA.x).normalize();
            const s = Math.sin(performance.now()*0.001 + e.userData.phase) * 0.6;
            e.position.addScaledVector(perp, s * dt * e.userData.speed);
          }

          // Shooting as projectiles if player is vulnerable
          e.userData.shootCooldown -= dt;
          if (playerVulnerable && e.userData.shootCooldown <= 0 && onEnemyShot) {
            // LOS check to player
            const from = e.position.clone().setY(e.position.y + 0.8);
            const toPlayer = playerPos.clone();
            const dir = toPlayer.clone().sub(from).normalize();
            this.ray.set(from, dir);
            this.ray.far = 60;
            const hits = this.ray.intersectObjects(this.obstacles, true);
            const firstObstacle = hits[0];
            const distToPlayer = from.distanceTo(toPlayer);
            const clear = !firstObstacle || firstObstacle.distance > distToPlayer;
            if (clear) {
              this.spawnProjectile(from, dir, 42, 'enemy', 2.0);
              onEnemyShot();
              e.userData.shootCooldown = 1.1 + Math.random()*0.6;
            } else {
              e.userData.shootCooldown = 0.3 + Math.random()*0.4;
            }
          }
        }

        // Face the player
        e.lookAt(playerPos.x, e.position.y, playerPos.z);

        // Resolve collisions vs world
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

      // Raycast against obstacles and shootables depending on owner
      this.ray.set(start, delta.clone().normalize());
      this.ray.far = delta.length() + 0.001;

      let hit = null;
      if (p.owner === 'player') {
        const colliders = [
          ...this.obstacles,
          ...this.enemyGroup.children,
          ...this.targetGroup.children
        ];
        const hits = this.ray.intersectObjects(colliders, true);
        hit = hits[0] || null;
        if (hit) {
          // Spawn tracer and handle impact
          this._spawnTracer(start, hit.point, 0xffe066, 0.06);
          // If enemy/target
          const kind = hit.object.userData?.type;
          if (kind === 'enemy' || kind === 'target') {
            this.handleHit(hit);
          }
          // Remove projectile
          this._removeProjectileAt(i);
          continue;
        }
      } else {
        // Enemy projectile: check obstacle first
        const hits = this.ray.intersectObjects(this.obstacles, true);
        hit = hits[0] || null;

        // Check player capsule (eye pos approx) if no obstacle hit nearer than player
        if (playerPos) {
          const closest = tmpVecA;
          const d = segmentPointDistance(start, end, playerPos, closest);
          const playerRadius = 0.45;
          if (d <= playerRadius) {
            // Make sure no obstacle closer than the hit
            const distSeg = start.distanceTo(closest);
            const block = hit && hit.distance < distSeg - 0.001;
            if (!block && onPlayerHit) {
              onPlayerHit(6);
              this._spawnTracer(start, closest.clone(), 0xbf5fff, 0.06);
              this._removeProjectileAt(i);
              continue;
            }
          }
        }

        if (hit) {
          this._spawnTracer(start, hit.point, 0xbf5fff, 0.06);
          this._removeProjectileAt(i);
          continue;
        }
      }

      // No hit: advance
      p.pos.copy(end);
      p.mesh.position.copy(p.pos);

      // Lifetime
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this._removeProjectileAt(i);
        continue;
      }
    }

    // Update and fade FX (tracers)
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const l = this.fxGroup.children[i];
      l.userData.ttl -= dt;
      const a = Math.max(0, l.userData.ttl / l.userData.maxTtl);
      l.material.opacity = a;
      if (l.userData.ttl <= 0) {
        l.geometry.dispose();
        l.material.dispose();
        this.fxGroup.remove(l);
      }
    }
  }

  _removeProjectileAt(i) {
    const p = this.projectiles[i];
    if (p.mesh) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.projectileGroup.remove(p.mesh);
    }
    this.projectiles.splice(i, 1);
  }

  handleHit(intersection) {
    const obj = intersection.object;

    if (obj.userData?.type === 'target') {
      obj.userData.health -= 1;
      if (obj.userData.health <= 0) {
        this.targetGroup.remove(obj);
        this.targets = this.targets.filter(t => t !== obj);
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
        this.spawnTargets(1);
        return { removed: true, kind: 'target', score: 1 };
      }
      return { removed: false, kind: 'target', score: 0 };
    }

    if (obj.userData?.type === 'enemy') {
      obj.userData.health -= 1;

      // Brief tint to indicate hit
      const mat = obj.material;
      const oldColor = mat.color.clone();
      mat.color.setHex(0xff7770);
      setTimeout(() => mat.color.copy(oldColor), 80);

      if (obj.userData.health <= 0) {
        this.enemyGroup.remove(obj);
        this.enemies = this.enemies.filter(e => e !== obj);
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
        // respawn same type
        this.spawnEnemies({ melee: obj.userData.kind === 'melee' ? 1 : 0, ranged: obj.userData.kind === 'ranged' ? 1 : 0 });
        return { removed: true, kind: 'enemy', score: 3 };
      }
      return { removed: false, kind: 'enemy', score: 0 };
    }

    return { removed: false, kind: 'unknown', score: 0 };
  }

  resolveCollisions(nextPos, playerRadius = 0.6, playerHeight = 1.7) {
    for (const obs of this.obstacles) {
      const aabb = obs.userData.aabb;
      aabb.setFromObject(obs);

      const min = aabb.min, max = aabb.max;

      // Only consider overlap if vertical spans overlap
      if (nextPos.y - playerHeight * 0.5 < max.y && nextPos.y + playerHeight * 0.5 > min.y) {
        const closestX = Math.max(min.x, Math.min(nextPos.x, max.x));
        const closestZ = Math.max(min.z, Math.min(nextPos.z, max.z));
        const dx = nextPos.x - closestX;
        const dz = nextPos.z - closestZ;
        const distSq = dx*dx + dz*dz;
        const r = playerRadius + 0.001;
        if (distSq < r*r) {
          const dist = Math.sqrt(distSq) || 0.0001;
          const push = r - dist;
          tmpVec3.set(dx / dist, 0, dz / dist).multiplyScalar(push);
          nextPos.add(tmpVec3);
        }
      }
    }
  }

  resetDynamic() {
    // Remove targets
    for (const t of this.targets) {
      this.targetGroup.remove(t);
      t.geometry.dispose();
      if (Array.isArray(t.material)) t.material.forEach(m => m.dispose());
      else t.material.dispose();
    }
    this.targets.length = 0;

    // Remove enemies
    for (const e of this.enemies) {
      this.enemyGroup.remove(e);
      e.geometry.dispose();
      if (Array.isArray(e.material)) e.material.forEach(m => m.dispose());
      else e.material.dispose();
    }
    this.enemies.length = 0;

    // Remove projectiles
    for (const p of this.projectiles) {
      if (p.mesh) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectileGroup.remove(p.mesh);
      }
    }
    this.projectiles.length = 0;

    // FX
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const l = this.fxGroup.children[i];
      l.geometry.dispose?.();
      l.material.dispose?.();
      this.fxGroup.remove(l);
    }

    // Respawn new entities
    this.spawnTargets(10);
    this.spawnEnemies({ melee: 4, ranged: 3 });
  }
}
