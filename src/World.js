import * as THREE from 'three';

const tmpVec3 = new THREE.Vector3();

export class World {
  constructor(scene) {
    this.scene = scene;

    this.targets = [];
    this.enemies = [];
    this.obstacles = [];

    this.targetGroup = new THREE.Group();
    this.enemyGroup = new THREE.Group();
    this.scene.add(this.targetGroup, this.enemyGroup);

    this._setupLights();
    this._setupFloor();
    this._setupObstacles();
    this._setupHouses();

    this.spawnTargets(12);
    this.spawnEnemies(6);
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(8, 12, 6);
    this.scene.add(ambient, dir);
  }

  _setupFloor() {
    const geo = new THREE.PlaneGeometry(200, 200, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x252a32, metalness: 0.1, roughness: 0.9 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    floor.name = 'floor';
    this.scene.add(floor);

    const grid = new THREE.GridHelper(200, 40, 0x444a56, 0x2a2f3a);
    this.scene.add(grid);
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
    // Very simple “houses” as solid blocks for a basic map layout
    const houseMat = new THREE.MeshStandardMaterial({ color: 0x373d4a, roughness: 0.85, metalness: 0.05 });
    const baseGeo = new THREE.BoxGeometry(8, 4.5, 8);
    const positions = [
      [-16, 2.25, -10],
      [12, 2.25, 14],
      [-10, 2.25, 16],
      [18, 2.25, -12],
      [0, 2.25, -20],
    ];
    for (const [x, y, z] of positions) {
      const house = new THREE.Mesh(baseGeo, houseMat);
      house.position.set(x, y, z);
      house.name = 'house';
      // Treat houses as obstacles for collision
      house.userData.aabb = new THREE.Box3().setFromObject(house);
      house.userData.static = true;
      this.scene.add(house);
      this.obstacles.push(house);
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
        (Math.random() - 0.5) * 60,
        1 + Math.random() * 6,
        (Math.random() - 0.5) * 60
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

  spawnEnemies(count = 4) {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd9534f,
        metalness: 0.1,
        roughness: 0.7
      });
      const enemy = new THREE.Mesh(geo, mat);
      enemy.position.set(
        (Math.random() - 0.5) * 80,
        1.0,
        (Math.random() - 0.5) * 80
      );
      enemy.userData = {
        type: 'enemy',
        health: 3,
        speed: 2.6 + Math.random() * 1.2,
        radius: 0.5,
        height: 2.0
      };
      this.enemyGroup.add(enemy);
      this.enemies.push(enemy);
    }
  }

  update(dt, playerPos = null) {
    // Targets idle motion
    for (const t of this.targets) {
      t.rotation.y += t.userData.rotSpeed * dt;
      t.position.y = t.userData.baseY + Math.sin(t.userData.bobPhase += dt * 2.0) * 0.25;
    }

    // Enemies chase the player if we have a player position
    if (playerPos) {
      for (const e of this.enemies) {
        // Horizontal chase only
        tmpVec3.set(playerPos.x, e.position.y, playerPos.z).sub(e.position);
        tmpVec3.y = 0;
        const dist = tmpVec3.length();
        if (dist > 0.001) {
          tmpVec3.normalize().multiplyScalar(e.userData.speed * dt);
          e.position.add(tmpVec3);

          // Simple obstacle avoidance by resolving collisions against world geometry
          const nextPos = e.position.clone();
          this.resolveCollisions(nextPos, e.userData.radius, e.userData.height);
          e.position.copy(nextPos);

          // Face the player a bit
          e.lookAt(playerPos.x, e.position.y, playerPos.z);
        }
      }
    }
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
        this.spawnEnemies(1);
        return { removed: true, kind: 'enemy', score: 3 };
      }
      return { removed: false, kind: 'enemy', score: 0 };
    }

    return { removed: false, kind: 'unknown', score: 0 };
  }

  resolveCollisions(nextPos, playerRadius = 0.6, playerHeight = 1.7) {
    for (const obs of this.obstacles) {
      const aabb = obs.userData.aabb;
      // Update AABB in case of any transforms (they're static here, but safe to refresh)
      aabb.setFromObject(obs);

      const min = aabb.min, max = aabb.max;

      // Only consider overlap if player's "capsule" overlaps vertically
      if (nextPos.y < max.y + playerHeight * 0.5 && nextPos.y - playerHeight * 0.5 < max.y) {
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
}
