import * as THREE from 'three';

const tmpVec3 = new THREE.Vector3();

export class World {
  constructor(scene) {
    this.scene = scene;
    this.targets = [];
    this.obstacles = [];
    this.targetGroup = new THREE.Group();
    this.scene.add(this.targetGroup);

    this._setupLights();
    this._setupFloor();
    this._setupObstacles();
    this.spawnTargets(12);
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 10, 3);
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

  update(dt) {
    for (const t of this.targets) {
      t.rotation.y += t.userData.rotSpeed * dt;
      t.position.y = t.userData.baseY + Math.sin(t.userData.bobPhase += dt * 2.0) * 0.25;
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
        return true;
      }
    }
    return false;
  }

  resolveCollisions(nextPos, playerRadius = 0.6, playerHeight = 1.7) {
    for (const obs of this.obstacles) {
      const aabb = obs.userData.aabb;
      aabb.copy(aabb).expandByScalar(0.0);

      const min = aabb.min, max = aabb.max;
      if (nextPos.y < max.y && nextPos.y + playerHeight > min.y) {
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
