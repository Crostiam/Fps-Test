import * as THREE from 'three';

// Simple Isaac-like room system: generate a connected graph of rooms on a grid,
// build meshes (floor, walls, door gaps, lockable gates), handle encounters,
// rewards, boss portal, and door-to-door transitions.
export class RoomManager {
  constructor(world, sound, applyPickupFn) {
    this.world = world;
    this.sound = sound;
    this.applyPickup = applyPickupFn;

    this.rooms = [];          // array of room objects
    this.roomByKey = new Map(); // "x,y" -> room
    this.currentRoom = null;  // room object
    this.groupsRoot = new THREE.Group(); // holds all room groups
    this.world.scene.add(this.groupsRoot);

    this.rewardOverlay = document.getElementById('rewardOverlay');
    this.rewardCards = document.getElementById('rewardCards');
    this.skipRewardBtn = document.getElementById('skipRewardBtn');

    this.ROOM_SIZE = 26;      // width/depth of interior area (meters)
    this.WALL_T = 0.6;
    this.DOOR_W = 5.0;
    this.ROOM_SPACING = 40;   // spacing between rooms in world coords
    this.locked = false;      // true while a room encounter is active
  }

  // Public: build a fresh floor’s layout/meshes and set starting room.
  generateNewFloor(floor = 1) {
    // Cleanup previous floor meshes and data
    this._disposeRooms();

    // Generate layout graph
    const count = 8 + Math.floor(Math.random() * 4); // 8..11 rooms
    const graph = this._genGraph(count);

    // Tag rooms: start, boss (farthest), a couple treasure rooms
    const start = graph.find(n => n.x === 0 && n.y === 0) || graph[0];
    start.type = 'start';
    const far = graph.slice().sort((a,b)=>this._manhattan(b, start)-this._manhattan(a, start))[0];
    if (far) far.type = 'boss';
    const rest = graph.filter(n => n !== start && n !== far);
    for (let i=0;i<Math.min(2, Math.max(0, rest.length-2)); i++) {
      rest[i].type = 'treasure';
    }
    for (const n of graph) if (!n.type) n.type = 'combat';

    // Build meshes in the scene
    for (const node of graph) this._buildRoom(node);

    // Set current room to start (no fight there)
    this._setCurrentRoom(start);
    this._unlockDoors(start); // start room never locks
  }

  // Called every frame: handle encounter clear and boss portal logic.
  update(dt) {
    if (!this.currentRoom) return;

    // If locked and there are no remaining room-scoped enemies, clear it
    if (this.locked) {
      let remaining = 0;
      for (const e of this.world.enemies) {
        if (e.userData && e.userData.scope === 'room' && e.userData.roomId === this.currentRoom.id) { remaining = 1; break; }
      }
      if (remaining === 0 && !this.world.activeBoss) {
        this.locked = false;
        this.currentRoom.cleared = true;
        this._unlockDoors(this.currentRoom);

        if (this.currentRoom.type === 'combat') {
          // Reward picker
          this._presentRewardPicker(() => {
            // nothing else
          });
        } else if (this.currentRoom.type === 'boss') {
          // Boss clear: spawn portal at center
          const pos = this._roomWorldCenter(this.currentRoom);
          pos.y = 0.1;
          this.world.spawnPortal(pos);
        }
      }
    }
  }

  // UI: show hint text for a nearby door if available; returns string or empty
  getDoorHint(playerPos) {
    const d = this._nearestDoorWithin(playerPos, 2.0);
    if (!d || !d.to) return '';
    if (this.locked) return 'Doors locked!';
    const name = d.to.type === 'boss' ? 'Boss' : d.to.type === 'treasure' ? 'Treasure' : 'Room';
    return `Press E to enter ${name}`;
  }

  // Handle door interaction; when true, teleportCb(newPos) is called and the room is switched.
  tryUseDoor(playerPos, interactPressed, teleportCb) {
    if (!interactPressed || this.locked) return false;
    const d = this._nearestDoorWithin(playerPos, 2.0);
    if (!d || !d.to) return false;

    // Teleport destination: just inside the opposite door of the target room
    const dest = this._doorLandingPosition(d.to, this._oppositeDir(d.dir));
    dest.y = this.world.playerHeight || 1.7;
    teleportCb(dest);

    this._setCurrentRoom(d.to);

    // Start encounter if needed
    if (!this.currentRoom.cleared) {
      if (this.currentRoom.type === 'combat') this._startCombatEncounter(this.currentRoom);
      if (this.currentRoom.type === 'treasure') this._spawnTreasure(this.currentRoom);
      if (this.currentRoom.type === 'boss') this._startBossEncounter(this.currentRoom);
      if (this.currentRoom.type === 'start') this._unlockDoors(this.currentRoom);
    }

    return true;
  }

  // ========= Internals =========

  _disposeRooms() {
    // Remove gate blockers from world obstacles
    for (const r of this.rooms) {
      for (const k of Object.keys(r.doors)) {
        const d = r.doors[k];
        if (d && d.blocker) {
          const idx = this.world.obstacles.indexOf(d.blocker);
          if (idx >= 0) this.world.obstacles.splice(idx, 1);
        }
      }
    }
    // Remove meshes
    while (this.groupsRoot.children.length) this.groupsRoot.remove(this.groupsRoot.children[0]);
    // Clear caches
    this.rooms = [];
    this.roomByKey.clear();
    this.currentRoom = null;
    this.locked = false;
    // Also clear portals from previous boss
    this.world.clearPortals();
  }

  _genGraph(targetRooms = 9) {
    // Basic randomized expansion on a small grid
    const maxExtent = 3; // roughly -3..3 in each axis
    const start = { x: 0, y: 0, id: '0,0', type: 'start', neighbors: {}, cleared: false };
    const placed = new Map();
    placed.set(start.id, start);

    const dirs = [
      { k:'N', dx:0, dy:-1 },
      { k:'S', dx:0, dy: 1 },
      { k:'W', dx:-1, dy:0 },
      { k:'E', dx: 1, dy:0 },
    ];

    const frontier = [start];
    while (placed.size < targetRooms && frontier.length) {
      const cur = frontier[Math.floor(Math.random() * frontier.length)];
      const options = dirs
        .map(d=>({ ...d, nx: cur.x + d.dx, ny: cur.y + d.dy }))
        .filter(d => Math.abs(d.nx) <= maxExtent && Math.abs(d.ny) <= maxExtent);
      if (!options.length) { frontier.splice(frontier.indexOf(cur),1); continue; }

      const pick = options[Math.floor(Math.random()*options.length)];
      const key = `${pick.nx},${pick.ny}`;
      if (!placed.has(key)) {
        const node = { x: pick.nx, y: pick.ny, id: key, type: 'combat', neighbors: {}, cleared: false };
        placed.set(key, node);
        // link
        cur.neighbors[pick.k] = node;
        node.neighbors[this._oppositeDir(pick.k)] = cur;
        frontier.push(node);
      }
    }

    // Return list with neighbors linked
    return Array.from(placed.values());
  }

  _buildRoom(node) {
    // Build a room group at world position
    const group = new THREE.Group();
    group.position.copy(this._roomOrigin(node));
    group.visible = false;
    group.name = `room_${node.id}`;
    this.groupsRoot.add(group);

    const size = this.ROOM_SIZE, half = size/2, h = 3.6;
    const matFloor = new THREE.MeshStandardMaterial({ color: 0x252a32, metalness: 0.08, roughness: 0.95 });
    const matWall  = new THREE.MeshStandardMaterial({ color: node.type === 'boss' ? 0x3a2448 : 0x2a2f3a, metalness: 0.05, roughness: 0.9 });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), matFloor);
    floor.rotation.x = -Math.PI/2; floor.position.set(0, 0, 0);
    floor.name = 'room_floor';
    group.add(floor);

    // Walls per side; leave door gap when neighbor exists
    const makeWall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matWall);
      m.position.set(x, h/2, z);
      m.name = 'room_wall';
      m.userData.aabb = new THREE.Box3().setFromObject(m);
      m.userData.static = true;
      group.add(m);
      this.world.obstacles.push(m);
    };

    const gap = this.DOOR_W, seg = (size - gap) / 2;
    // North (z = -half)
    if (node.neighbors['N']) {
      makeWall(seg, this.WALL_T, -((gap/2) + seg/2), -half + this.WALL_T/2);
      makeWall(seg, this.WALL_T,  ((gap/2) + seg/2), -half + this.WALL_T/2);
    } else {
      makeWall(size, this.WALL_T, 0, -half + this.WALL_T/2);
    }
    // South (z = +half)
    if (node.neighbors['S']) {
      makeWall(seg, this.WALL_T, -((gap/2) + seg/2),  half - this.WALL_T/2);
      makeWall(seg, this.WALL_T,  ((gap/2) + seg/2),  half - this.WALL_T/2);
    } else {
      makeWall(size, this.WALL_T, 0, half - this.WALL_T/2);
    }
    // West (x = -half)
    if (node.neighbors['W']) {
      makeWall(this.WALL_T, seg, -half + this.WALL_T/2, -((gap/2) + seg/2));
      makeWall(this.WALL_T, seg, -half + this.WALL_T/2,  ((gap/2) + seg/2));
    } else {
      makeWall(this.WALL_T, size, -half + this.WALL_T/2, 0);
    }
    // East (x = +half)
    if (node.neighbors['E']) {
      makeWall(this.WALL_T, seg, half - this.WALL_T/2, -((gap/2) + seg/2));
      makeWall(this.WALL_T, seg, half - this.WALL_T/2,  ((gap/2) + seg/2));
    } else {
      makeWall(this.WALL_T, size, half - this.WALL_T/2, 0);
    }

    // Door blockers (gates) per open side
    node.doors = {};
    const mkGate = (dir) => {
      const w = dir === 'N' || dir === 'S' ? gap : this.WALL_T;
      const d = dir === 'N' || dir === 'S' ? this.WALL_T : gap;
      const offs = this._doorLocalOffset(dir);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.2, roughness: 0.7, emissive: 0x111827, emissiveIntensity: 0.08 }));
      m.position.copy(offs).setY(h/2);
      m.visible = false; m.name = 'room_gate';
      group.add(m);
      node.doors[dir] = { blocker: m, to: node.neighbors[dir], dir };
      return m;
    };
    for (const dir of ['N','S','W','E']) if (node.neighbors[dir]) mkGate(dir);

    // Store
    node.group = group;
    node.cleared = (node.type === 'start'); // start room considered clear
    node.id = `${node.x},${node.y}`;
    this.rooms.push(node);
    this.roomByKey.set(node.id, node);
  }

  _setCurrentRoom(room) {
    // Toggle visibility
    for (const r of this.rooms) r.group.visible = (r === room);
    this.currentRoom = room;

    // Minor flourish: change fog (optional)
    if (this.world.scene && this.world.scene.fog) {
      this.world.scene.fog.density = 0.015;
    }
  }

  _startCombatEncounter(room) {
    this._lockDoors(room);
    this.locked = true;
    const center = this._roomWorldCenter(room);
    const radius = (this.ROOM_SIZE - 6) * 0.5;
    const jitter = () => (Math.random() * 2 - 1) * radius;

    const f = this.world.floor;
    const melee = 3 + Math.floor((f - 1) * 1.2);
    const ranged = 2 + Math.floor((f - 1) * 0.8);
    const extra = Math.floor(f / 2);
    const pool = ['skitter','brute','bomber','sniper'];

    for (let i=0;i<melee;i++) this.world.spawnEnemyAt('melee', new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
    for (let i=0;i<ranged;i++) this.world.spawnEnemyAt('ranged', new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
    for (let i=0;i<extra;i++) this.world.spawnEnemyAt(pool[Math.floor(Math.random()*pool.length)], new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
  }

  _startBossEncounter(room) {
    this._lockDoors(room);
    this.locked = true;
    // Spawn a boss using world's helper at room center
    const center = this._roomWorldCenter(room);
    // Use one of the three patterns
    const kinds = ['castle','pyramid','ice'];
    const pick = kinds[Math.floor(Math.random()*kinds.length)];
    // Temporarily set fake lair centers so world._spawnBossFor can use them
    this.world.castle = { center: center }; this.world.pyramid = { center: center }; this.world.icecave = { center: center };
    this.world._spawnBossFor(pick);
  }

  _spawnTreasure(room) {
    // No lock; just spawn 1–2 free powerups
    this._unlockDoors(room);
    const center = this._roomWorldCenter(room);
    const kinds = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun'];
    const count = 1 + Math.floor(Math.random()*2);
    for (let i=0;i<count;i++) {
      const k = kinds[Math.floor(Math.random()*kinds.length)];
      const mesh = this.world._makePowerupMesh(k);
      mesh.position.set(center.x + (Math.random()-0.5)*4, 0.6, center.z + (Math.random()-0.5)*4);
      mesh.userData = { type: 'powerup', kind: k, spin: Math.random()*Math.PI*2, label: this.world._powerupLabel(k) };
      this.world.powerupGroup.add(mesh);
    }
    room.cleared = true;
  }

  _presentRewardPicker(done) {
    const overlay = this.rewardOverlay;
    const container = this.rewardCards;
    if (!overlay || !container) { done(); return; }

    const rewards = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun'];
    const picks = [];
    const pool = rewards.slice();
    while (picks.length < 3 && pool.length) {
      const i = Math.floor(Math.random()*pool.length);
      picks.push(pool.splice(i,1)[0]);
    }

    container.innerHTML = '';
    const labels = {
      health: ['+25 Health', 'Restore some health.'],
      shield: ['Shield', 'Temporary invulnerability.'],
      damage: ['Damage Boost', 'Deal more damage for a short time.'],
      firerate: ['Fire Rate Boost', 'Fire faster for a short time.'],
      ammo_rifle: ['Rifle Ammo', 'Add rifle reserve ammo.'],
      ammo_shotgun: ['Shotgun Ammo', 'Add shotgun reserve ammo.'],
      weapon_rifle: ['Unlock Rifle', 'Enable the rifle weapon.'],
      weapon_shotgun: ['Unlock Shotgun', 'Enable the shotgun weapon.'],
    };

    const makeCard = (kind, title, desc) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<h3>${title}</h3><p>${desc}</p>`;
      div.addEventListener('click', () => {
        overlay.style.display = 'none';
        this.applyPickup(kind);
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
        done();
      });
      return div;
    };
    for (const k of picks) {
      const [t,d] = labels[k] || ['Reward','Take this!'];
      container.appendChild(makeCard(k, t, d));
    }

    if (this.skipRewardBtn) {
      this.skipRewardBtn.onclick = () => {
        overlay.style.display = 'none';
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
        done();
      };
    }

    overlay.style.display = 'grid';
    if (document.exitPointerLock) document.exitPointerLock();
  }

  _lockDoors(room) {
    for (const dir of ['N','S','W','E']) {
      const d = room.doors[dir];
      if (d && d.blocker) {
        d.blocker.visible = true;
        d.blocker.userData.aabb = new THREE.Box3().setFromObject(d.blocker);
        d.blocker.userData.static = true;
        if (!this.world.obstacles.includes(d.blocker)) this.world.obstacles.push(d.blocker);
      }
    }
  }
  _unlockDoors(room) {
    for (const dir of ['N','S','W','E']) {
      const d = room.doors[dir];
      if (d && d.blocker) {
        d.blocker.visible = false;
        const idx = this.world.obstacles.indexOf(d.blocker);
        if (idx >= 0) this.world.obstacles.splice(idx, 1);
      }
    }
  }

  _nearestDoorWithin(playerPos, maxDist) {
    if (!this.currentRoom) return null;
    const doors = [];
    for (const dir of ['N','S','W','E']) {
      const link = this.currentRoom.neighbors[dir];
      if (!link) continue;
      const worldPos = this._doorWorldPosition(this.currentRoom, dir);
      const d = worldPos.distanceTo(playerPos);
      if (d <= maxDist) doors.push({ dir, to: link, pos: worldPos, dist: d });
    }
    doors.sort((a,b)=>a.dist-b.dist);
    return doors[0] || null;
  }

  _doorLocalOffset(dir) {
    const half = this.ROOM_SIZE/2;
    if (dir === 'N') return new THREE.Vector3(0, 0, -half + this.WALL_T/2);
    if (dir === 'S') return new THREE.Vector3(0, 0,  half - this.WALL_T/2);
    if (dir === 'W') return new THREE.Vector3(-half + this.WALL_T/2, 0, 0);
    return new THREE.Vector3( half - this.WALL_T/2, 0, 0);
  }
  _doorWorldPosition(room, dir) {
    const local = (dir === 'N' || dir === 'S')
      ? new THREE.Vector3(0, 0, dir === 'N' ? -this.ROOM_SIZE/2 : this.ROOM_SIZE/2)
      : new THREE.Vector3(dir === 'W' ? -this.ROOM_SIZE/2 : this.ROOM_SIZE/2, 0, 0);
    const pos = local.add(room.group.position);
    pos.y = (this.world.playerHeight || 1.7) - 0.2;
    return pos;
  }
  _doorLandingPosition(room, dirIntoRoom) {
    // landing a bit inside the room from the given side
    const offset = 3.0;
    const base = room.group.position.clone();
    if (dirIntoRoom === 'N') return base.add(new THREE.Vector3(0, 0, -this.ROOM_SIZE/2 + offset));
    if (dirIntoRoom === 'S') return base.add(new THREE.Vector3(0, 0,  this.ROOM_SIZE/2 - offset));
    if (dirIntoRoom === 'W') return base.add(new THREE.Vector3(-this.ROOM_SIZE/2 + offset, 0, 0));
    return base.add(new THREE.Vector3( this.ROOM_SIZE/2 - offset, 0, 0));
  }
  _roomOrigin(node) {
    return new THREE.Vector3(node.x * this.ROOM_SPACING, 0, node.y * this.ROOM_SPACING);
  }
  _roomWorldCenter(node) {
    return this._roomOrigin(node).clone();
  }
  _manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  _oppositeDir(d) { return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'W' ? 'E' : 'W'; }
}
