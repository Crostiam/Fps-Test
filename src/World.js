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
    this.enemyGroup = new THREE.Group();
    this.powerupGroup = new THREE.Group();
    this.goldGroup = new THREE.Group();
    this.portalGroup = new THREE.Group();

    this.scene.add(this.enemyGroup, this.projectileGroup, this.fxGroup, this.powerupGroup, this.goldGroup, this.portalGroup);

    // Data
    this.enemies = [];
    this.obstacles = [];
    this.projectiles = [];
    this.portals = [];
    this.floor = 1;
    this.difficulty = 1;
    this.activeBoss = null;
    this.activeBossKind = null;

    // Player ref values (read by RoomManager/main)
    this.playerHeight = 1.7;

    // Setup (simple lights and a very large floor to avoid "falling"; rooms add their own walls)
    this._setupLights();
    this._setupBaseFloor();

    this.ray = new THREE.Raycaster();
  }

  startFloor(floor) {
    this.floor = floor;
    this.difficulty = 1 + (floor - 1) * 0.35;
    this.resetDynamic(true);
  }

  // Scene basics
  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202028, 0.55);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 14, 6);
    this.scene.add(hemi, dir);
  }
  _setupBaseFloor() {
    const geo = new THREE.PlaneGeometry(1000, 1000);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, metalness: 0.03, roughness: 0.98 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'base_floor';
    this.scene.add(floor);
  }

  // Enemies
  spawnEnemyAt(kind, position, scope = 'room', roomId = null) {
    const healthScale = this.difficulty;
    const speedScale = 1 + (this.floor - 1) * 0.05;

    let mesh = null, h = 2.0;
    if (kind === 'melee') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.0, 10), new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.7, metalness: 0.1 }));
    } else if (kind === 'ranged') {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0x9b59b6, roughness: 0.7, metalness: 0.1 }));
      h = 1.4;
    } else if (kind === 'skitter') {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.6, metalness: 0.15, emissive: 0x0a3, emissiveIntensity: 0.2 }));
      h = 1.1;
    } else if (kind === 'brute') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1.2), new THREE.MeshStandardMaterial({ color: 0x8e44ad, roughness: 0.8, metalness: 0.08 }));
      h = 2.4;
    } else if (kind === 'sniper') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x1abc9c, roughness: 0.6, metalness: 0.2, emissive: 0x0b6b5f, emissiveIntensity: 0.25 }));
      h = 2.6;
    } else if (kind === 'bomber') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.6, metalness: 0.2, emissive: 0x6b4f0f, emissiveIntensity: 0.2 }));
      h = 1.6;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0xd9534f, roughness: 0.7, metalness: 0.1 }));
      h = 2.0;
    }

    mesh.position.set(position.x, h*0.5, position.z);
    const baseHealth = (kind === 'brute') ? 8 : (kind === 'skitter') ? 2 : (kind === 'sniper' || kind === 'bomber') ? 4 : 3;
    const baseSpeed = (kind === 'skitter') ? 4.2 : (kind === 'brute') ? 2.0 : (kind === 'sniper') ? 2.2 : (kind === 'bomber') ? 2.4 : (kind === 'ranged' ? 2.4 : 3.0);

    mesh.userData = {
      type: 'enemy',
      kind,
      scope,
      roomId,
      health: Math.round(baseHealth * healthScale),
      speed: baseSpeed * speedScale * (0.9 + Math.random()*0.3),
      radius: 0.6,
      height: h,
      shootCooldown: 0,
      touchCd: 0,
      phase: Math.random() * Math.PI * 2
    };
    this.enemyGroup.add(mesh);
    this.enemies.push(mesh);
    return mesh;
  }

  // Boss helper (re-uses older patterns)
  _spawnBossFor(kind) {
    if (this.activeBoss) return;
    const healthScale = 1 + (this.floor - 1) * 0.4;
    let pos = null, mesh = null, pattern = null, color = 0x8b5cf6, emissive = 0x5b21b6;

    // Expect a .center vector passed in via temporary lair stubs
    if (kind === 'castle') {
      pos = (this.castle && this.castle.center) ? this.castle.center.clone() : new THREE.Vector3();
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12),
        new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6, emissive, emissiveIntensity: 0.2 }));
      mesh.position.set(pos.x, 1.6, pos.z);
      pattern = 'bursts';
    } else if (kind === 'pyramid') {
      pos = (this.pyramid && this.pyramid.center) ? this.pyramid.center.clone() : new THREE.Vector3();
      mesh = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.0, 8),
        new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.25, roughness: 0.6, emissive: 0x92400e, emissiveIntensity: 0.25 }));
      mesh.position.set(pos.x, 1.5, pos.z);
      pattern = 'spread';
    } else {
      pos = (this.icecave && this.icecave.center) ? this.icecave.center.clone() : new THREE.Vector3();
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0),
        new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.3, roughness: 0.5, emissive: 0x1d4ed8, emissiveIntensity: 0.3 }));
      mesh.position.set(pos.x, 1.4, pos.z);
      pattern = 'rings';
    }
    mesh.userData = {
      type: 'boss',
      kind: kind,
      health: Math.round(60 * healthScale),
      speed: 2.0,
      radius: 1.0,
      height: 3.0,
      shootCooldown: 1.0,
      burstCooldown: 4.0,
      pattern: pattern
    };
    this.enemyGroup.add(mesh);
    this.enemies.push(mesh);
    this.activeBoss = mesh;
    this.activeBossKind = kind;
  }

  // Projectiles
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

  // Powerups (used by treasure and rewards)
  spawnPowerups(n = 8) {
    const kinds = ['health', 'shield', 'damage', 'firerate', 'weapon_rifle', 'weapon_shotgun', 'ammo_rifle', 'ammo_shotgun'];
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const mesh = this._makePowerupMesh(kind);
      mesh.position.set((Math.random()-0.5)*6, 0.6, (Math.random()-0.5)*6);
      mesh.userData = { type: 'powerup', kind, spin: Math.random()*Math.PI*2, label: this._powerupLabel(kind) };
      this.powerupGroup.add(mesh);
    }
  }
  _makePowerupMesh(kind) {
    const color = {
      health: 0x4ade80, shield: 0x60a5fa, damage: 0xf59e0b, firerate: 0xf472b6,
      weapon_rifle: 0x9ca3af, weapon_shotgun: 0xef4444, ammo_rifle: 0x93c5fd, ammo_shotgun: 0xfda4af
    }[kind] || 0xffffff;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 });
    return new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat);
  }
  _powerupLabel(kind) {
    const map = {
      health: '+25 Health',
      shield: 'Temporary Shield',
      damage: 'Damage Boost',
      firerate: 'Fire-Rate Boost',
      weapon_rifle: 'Unlock Rifle',
      weapon_shotgun: 'Unlock Shotgun',
      ammo_rifle: 'Rifle Ammo',
      ammo_shotgun: 'Shotgun Ammo'
    };
    return map[kind] || 'Powerup';
  }

  // Gold and portal
  spawnGold(point, amount = 1) {
    const geo = new THREE.IcosahedronGeometry(0.15, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(point);
    m.position.y = Math.max(m.position.y, 1.2);
    m.userData = { type: 'gold', amount, ttl: 18, spin: Math.random()*Math.PI*2, vy: 2.0, vx: 0.0, vz: 0.0 };
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

  // Update world dynamics: coins, projectiles, enemies (AI)
  update(dt, playerPos, onPlayerHit, onEnemyShot, playerVulnerable = true) {
    // Powerups idle
    for (const p of this.powerupGroup.children) {
      p.userData.spin += dt;
      p.rotation.y = p.userData.spin;
      p.position.y = 0.6 + Math.sin(p.userData.spin*2.0)*0.08;
    }

    // Gold fall + magnet
    const magnetRadius = 7.0;
    for (let i = this.goldGroup.children.length-1; i>=0; i--) {
      const g = this.goldGroup.children[i];
      g.userData.ttl -= dt;
      g.userData.spin += dt*4;
      g.rotation.y = g.userData.spin;

      if (g.position.y > 0.5) {
        g.userData.vy -= 9.8 * dt;
        g.position.y += g.userData.vy * dt;
        if (g.position.y <= 0.5) { g.position.y = 0.5; g.userData.vy = 0; }
      }

      if (playerPos) {
        const head = playerPos.clone();
        const feet = playerPos.clone().add(new THREE.Vector3(0, -this.playerHeight, 0));
        const closest = tmpVecA;
        const d3 = segmentPointDistance(feet, head, g.position, closest);
        if (d3 < magnetRadius) {
          const to = closest;
          const dx = to.x - g.position.x;
          const dz = to.z - g.position.z;
          const distXZ = Math.hypot(dx, dz) || 0.0001;
          const ax = (dx / distXZ) * 22 * ((magnetRadius - d3) / magnetRadius);
          const az = (dz / distXZ) * 22 * ((magnetRadius - d3) / magnetRadius);
          g.userData.vx += ax * dt;
          g.userData.vz += az * dt;
        }
        const damp = Math.pow(0.90, dt * 60);
        g.userData.vx *= damp;
        g.userData.vz *= damp;
        g.position.x += g.userData.vx * dt;
        g.position.z += g.userData.vz * dt;
      }

      if (g.userData.ttl <= 0) {
        if (g.geometry && g.geometry.dispose) g.geometry.dispose();
        if (g.material) { if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose()); else if (g.material.dispose) g.material.dispose(); }
        this.goldGroup.remove(g);
      }
    }

    // Portals spin
    for (const r of this.portalGroup.children) {
      r.userData.spin += dt;
      r.rotation.z = r.userData.spin;
    }

    // Enemies
    if (playerPos) {
      for (const e of this.enemies) {
        const isBoss = e.userData.type === 'boss';
        const kind = isBoss ? 'boss' : e.userData.kind;

        tmpVecA.set(playerPos.x, e.position.y, playerPos.z).sub(e.position); tmpVecA.y = 0;
        const dist = tmpVecA.length(); if (dist > 0.001) tmpVecA.normalize();

        if (!isBoss) {
          if (kind === 'melee' || kind === 'skitter' || kind === 'brute' || kind === 'bomber') {
            const targetDist = (kind === 'bomber') ? 10 : 0;
            if (targetDist > 0) {
              if (dist < targetDist) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
              else e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
            } else {
              e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
            }
            if (kind !== 'bomber') {
              e.userData.touchCd = Math.max(0, e.userData.touchCd - dt);
              if (onPlayerHit && playerVulnerable) {
                const hitDmg = (kind === 'brute') ? Math.round(12 * this.difficulty) : Math.round(8 * this.difficulty);
                if (dist < 1.2 && e.userData.touchCd <= 0) {
                  onPlayerHit(hitDmg);
                  e.userData.touchCd = 0.6;
                }
              }
            }
            if (kind === 'bomber') {
              e.userData.shootCooldown -= dt;
              if (playerVulnerable && e.userData.shootCooldown <= 0 && onEnemyShot) {
                const from = e.position.clone().setY(e.position.y + 0.8);
                const dir = playerPos.clone().sub(from).normalize();
                const dmg = Math.round(12 * this.difficulty);
                this.spawnProjectile(from, dir, 28, 'enemy', 2.6, dmg);
                onEnemyShot();
                e.userData.shootCooldown = 1.6 + Math.random()*0.6;
              }
            }
          } else if (kind === 'ranged') {
            const min = 12, max = 24;
            if (dist < min) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
            else if (dist > max) e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
            else {
              tmpVecB.set(-tmpVecA.z, 0, tmpVecA.x).normalize();
              const s = Math.sin(performance.now()*0.001 + e.userData.phase) * 0.6;
              e.position.addScaledVector(tmpVecB, s * dt * e.userData.speed);
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
          } else if (kind === 'sniper') {
            const min = 28, max = 44;
            if (dist < min) e.position.addScaledVector(tmpVecA, -e.userData.speed * dt);
            else if (dist > max) e.position.addScaledVector(tmpVecA, e.userData.speed * dt);
            e.userData.shootCooldown -= dt;
            if (playerVulnerable && e.userData.shootCooldown <= 0 && onEnemyShot) {
              const from = e.position.clone().setY(e.position.y + 1.2);
              const dir = playerPos.clone().sub(from).normalize();
              this.ray.set(from, dir); this.ray.far = 90;
              const hits = this.ray.intersectObjects(this.obstacles, true);
              const clear = !hits[0] || hits[0].distance > from.distanceTo(playerPos);
              if (clear) {
                const dmg = Math.round(14 * this.difficulty);
                this.spawnProjectile(from, dir, 70, 'enemy', 2.8, dmg);
                onEnemyShot();
                e.userData.shootCooldown = 2.6 + Math.random()*0.8;
              } else e.userData.shootCooldown = 0.6 + Math.random()*0.6;
            }
          }
        } else {
          // Boss behaviors
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

        // Resolve collisions vs walls/gates
        const nextPos = e.position.clone();
        this.resolveCollisions(nextPos, e.userData.radius, e.userData.height);
        e.position.copy(nextPos);
      }
    }

    // Projectiles
    if (playerPos) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        const start = p.pos.clone();
        const delta = tmpVec3.copy(p.vel).multiplyScalar(dt);
        const end = start.clone().add(delta);
        this.ray.set(start, delta.clone().normalize());
        this.ray.far = delta.length() + 0.001;

        let hit = null;
        if (p.owner === 'player') {
          const colliders = [...this.obstacles, ...this.enemyGroup.children];
          const hits = this.ray.intersectObjects(colliders, true);
          hit = hits[0] || null;
          if (hit) {
            this._spawnTracer(start, hit.point, 0xffe066, 0.06);
            const kind = hit.object.userData && hit.object.userData.type ? hit.object.userData.type : null;
            if (kind === 'enemy' || kind === 'boss') {
              this.handleHit(hit, p.damage);
            }
            this._removeProjectileAt(i);
            continue;
          }
        } else {
          const hits = this.ray.intersectObjects(this.obstacles, true);
          hit = hits[0] || null;
          let blockedDist = hit ? hit.distance : Infinity;

          const head = playerPos.clone();
          const feet = playerPos.clone().add(new THREE.Vector3(0, -this.playerHeight, 0));
          const closest = tmpVecA;
          const d = segmentPointDistance(feet, head, start, closest);
          const playerRadius = 0.45;
          if (d <= playerRadius) {
            const distSeg = start.distanceTo(closest);
            const blocked = distSeg > blockedDist - 0.001;
            if (!blocked && onPlayerHit && playerVulnerable) {
              onPlayerHit(p.damage);
              this._spawnTracer(start, closest.clone(), 0xbf5fff, 0.06);
              this._removeProjectileAt(i);
              continue;
            }
          }
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
    const type = obj.userData && obj.userData.type ? obj.userData.type : null;

    if (type === 'enemy') {
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
        if (obj.material) { if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose()); else if (obj.material.dispose) obj.material.dispose(); }
        return { removed: true, kind: 'enemy', score: 3 };
      }
      return { removed: false, kind: 'enemy', score: 0 };
    }

    if (type === 'boss') {
      obj.userData.health -= damage;
      const mat = obj.material;
      if (mat) {
        const oldE = mat.emissiveIntensity || 0;
        mat.emissiveIntensity = 0.5;
        setTimeout(() => { if (mat) mat.emissiveIntensity = oldE; }, 80);
      }
      if (obj.userData.health <= 0) {
        for (let i=0;i<20;i++) this.spawnGold(intersection.point.clone().add(new THREE.Vector3((Math.random()-0.5)*2.2, 0, (Math.random()-0.5)*2.2)), 3);
        this.enemyGroup.remove(obj);
        this.enemies = this.enemies.filter(e => e !== obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) { if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose()); else if (obj.material.dispose) obj.material.dispose(); }
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

  // Interactions
  checkPlayerPickups(playerPos, playerHeight, onPowerup, onGold) {
    const head = playerPos.clone();
    const feet = playerPos.clone().add(new THREE.Vector3(0, -playerHeight, 0));
    const pickupRadius = 1.7;
    for (let i = this.goldGroup.children.length - 1; i >= 0; i--) {
      const g = this.goldGroup.children[i];
      const closest = tmpVecA;
      const d3 = segmentPointDistance(feet, head, g.position, closest);
      if (d3 < pickupRadius) {
        const amt = g.userData.amount || 1;
        if (g.geometry && g.geometry.dispose) g.geometry.dispose();
        if (g.material) { if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose()); else if (g.material.dispose) g.material.dispose(); }
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
      if (r.material) { if (Array.isArray(r.material)) r.material.forEach(m=>m && m.dispose && m.dispose()); else if (r.material.dispose) r.material.dispose(); }
      this.portalGroup.remove(r);
    }
    this.portals.length = 0;
  }

  // Reset dynamic content
  resetDynamic(clearPortalsToo = true) {
    for (const e of this.enemies) {
      this.enemyGroup.remove(e);
      if (e.geometry && e.geometry.dispose) e.geometry.dispose();
      if (e.material) { if (Array.isArray(e.material)) e.material.forEach(m=>m && m.dispose && m.dispose()); else if (e.material.dispose) e.material.dispose(); }
    }
    this.enemies.length = 0; this.activeBoss = null; this.activeBossKind = null;

    for (const p of this.projectiles) {
      if (p.mesh) {
        if (p.mesh.geometry && p.mesh.geometry.dispose) p.mesh.geometry.dispose();
        if (p.mesh.material) { if (Array.isArray(p.mesh.material)) p.mesh.material.forEach(m=>m && m.dispose && m.dispose()); else if (p.mesh.material.dispose) p.mesh.material.dispose(); }
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
      if (p.material) { if (Array.isArray(p.material)) p.material.forEach(m=>m && m.dispose && m.dispose()); else if (p.material.dispose) p.material.dispose(); }
      this.powerupGroup.remove(p);
    }

    for (let i = this.goldGroup.children.length - 1; i >= 0; i--) {
      const g = this.goldGroup.children[i];
      if (g.geometry && g.geometry.dispose) g.geometry.dispose();
      if (g.material) { if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose()); else if (g.material.dispose) g.material.dispose(); }
      this.goldGroup.remove(g);
    }

    if (clearPortalsToo) this.clearPortals();
  }
}
