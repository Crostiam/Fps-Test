import * as THREE from 'three';

export class RoomManager {
  constructor(world, sound, applyPickupFn) {
    this.world = world;
    this.sound = sound;
    this.applyPickup = applyPickupFn;

    this.rooms = [];
    this.roomByKey = new Map();
    this.currentRoom = null;
    this.groupsRoot = new THREE.Group();
    this.world.scene.add(this.groupsRoot);

    // Pedestals (interactable rewards)
    this.pedestals = []; // { mesh:Group, kind, roomId, opened }

    // Minimap
    this.minimap = document.getElementById('minimap');
    this.visited = new Set();
    this.revealed = new Set();

    // UI
    this.rewardOverlay = document.getElementById('rewardOverlay');
    this.rewardCards = document.getElementById('rewardCards');
    this.skipRewardBtn = document.getElementById('skipRewardBtn');

    // Room params
    this.ROOM_SIZE = 26;
    this.WALL_T = 0.6;
    this.DOOR_W = 5.0;
    this.ROOM_SPACING = 40;

    this.locked = false;

    // Optional teleport callback (provided by main)
    this.teleportCb = null;
  }

  setTeleport(cb) { this.teleportCb = cb; }

  generateNewFloor(floor = 1) {
    this._disposeRooms();

    // Generate a small connected graph
    const count = 8 + Math.floor(Math.random() * 4);
    const graph = this._genGraph(count);

    // Assign room types
    const start = graph.find(n => n.x === 0 && n.y === 0) || graph[0];
    start.type = 'start';
    const far = graph.slice().sort((a,b)=>this._manhattan(b,start)-this._manhattan(a,start))[0];
    if (far) far.type = 'boss';
    const rest = graph.filter(n => n !== start && n !== far);
    for (let i=0;i<Math.min(2, Math.max(0, rest.length-2)); i++) rest[i].type = 'treasure';
    for (const n of graph) if (!n.type) n.type = 'combat';

    // Build geometry
    for (const node of graph) this._buildRoom(node);

    // Start
    this._setCurrentRoom(start);
    this._unlockDoors(start); // start room never locks
    this._markVisited(start);
    this._renderMinimap();
  }

  update(dt) {
    if (!this.currentRoom) return;

    // Spin/bob pedestal gems so you can see them easily
    for (const p of this.pedestals) {
      const gem = p.mesh.children.find(c => c.name === 'pedestal_gem');
      if (gem) {
        gem.userData = gem.userData || {};
        gem.userData.spin = (gem.userData.spin || 0) + dt * 2;
        gem.rotation.y = gem.userData.spin;
        gem.position.y = 1.0 + Math.sin(gem.userData.spin * 2) * 0.06;
      }
    }

    // Check room clear if locked
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
          this._spawnRewardPedestal(this.currentRoom);
        } else if (this.currentRoom.type === 'boss') {
          // Boss clear: move portal to Start room and teleport player there
          const start = this.rooms.find(r => r.type === 'start') || this.currentRoom;
          const startCenter = this._roomWorldCenter(start);
          startCenter.y = 0.1;
          this.world.clearPortals();
          this.world.spawnPortal(startCenter);
          // Teleport player to start room (just inside center)
          if (this.teleportCb) {
            const dest = startCenter.clone(); dest.y = (this.world.playerHeight || 1.7);
            this.teleportCb(dest);
          }
          // Make sure Start room is visible/active
          this._setCurrentRoom(start);
          this._markVisited(start);
        }
      }
    }
  }

  // Door usage: blocks walking and bullets until pressing E near the shield
  getDoorHint(playerPos) {
    const d = this._nearestDoorWithin(playerPos, 2.0);
    if (!d || !d.to) return '';
    if (this.locked) return 'Doors locked!';
    const name = d.to.type === 'boss' ? 'Boss' : d.to.type === 'treasure' ? 'Treasure' : 'Room';
    return `Press E to enter ${name}`;
  }

  tryUseDoor(playerPos, interactPressed, teleportCb) {
    if (!interactPressed || this.locked) return false;
    const d = this._nearestDoorWithin(playerPos, 2.0);
    if (!d || !d.to) return false;

    // Teleport to opposite door inside target room
    const dest = this._doorLandingPosition(d.to, this._oppositeDir(d.dir));
    dest.y = this.world.playerHeight || 1.7;
    teleportCb(dest);

    this._setCurrentRoom(d.to);
    this._markVisited(d.to);

    if (!this.currentRoom.cleared) {
      if (this.currentRoom.type === 'combat') this._startCombatEncounter(this.currentRoom);
      if (this.currentRoom.type === 'treasure') this._spawnTreasure(this.currentRoom);
      if (this.currentRoom.type === 'boss') this._startBossEncounter(this.currentRoom);
      if (this.currentRoom.type === 'start') this._unlockDoors(this.currentRoom);
    }

    return true;
  }

  // Pedestals (crate workaround)
  getPedestalHint(playerPos) {
    const p = this._nearestPedestalWithin(playerPos, 2.0);
    if (!p || p.opened) return '';
    const label = this.world._powerupLabel ? this.world._powerupLabel(p.kind) : 'Reward';
    return `Press E to pick up: ${label}`;
  }
  tryOpenPedestal(playerPos, interactPressed) {
    if (!interactPressed) return false;
    const p = this._nearestPedestalWithin(playerPos, 2.0);
    if (!p || p.opened) return false;
    p.opened = true;
    // Apply directly and remove pedestal
    this.applyPickup(p.kind);
    this._removePedestal(p);
    return true;
  }

  // ===== Internals =====

  _disposeRooms() {
    // Remove gate/shields from obstacles
    for (const r of this.rooms) {
      for (const dir of ['N','S','W','E']) {
        const d = r.doors?.[dir];
        if (d && d.blocker) {
          const idx = this.world.obstacles.indexOf(d.blocker);
          if (idx >= 0) this.world.obstacles.splice(idx, 1);
        }
        if (d && d.shield) {
          const idx2 = this.world.obstacles.indexOf(d.shield);
          if (idx2 >= 0) this.world.obstacles.splice(idx2, 1);
        }
      }
    }
    // Remove pedestals
    for (let i=this.pedestals.length-1;i>=0;i--) this._removePedestal(this.pedestals[i]);
    this.pedestals.length = 0;

    // Remove meshes
    while (this.groupsRoot.children.length) this.groupsRoot.remove(this.groupsRoot.children[0]);
    this.rooms = [];
    this.roomByKey.clear();
    this.currentRoom = null;
    this.locked = false;

    // Minimap
    this.visited.clear();
    this.revealed.clear();

    // Portals from last boss
    this.world.clearPortals();
  }

  _genGraph(targetRooms = 9) {
    const maxExtent = 3;
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
        cur.neighbors[pick.k] = node;
        node.neighbors[this._oppositeDir(pick.k)] = cur;
        frontier.push(node);
      }
    }

    return Array.from(placed.values());
  }

  _buildRoom(node) {
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

    // Walls with door gaps
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

    // North
    if (node.neighbors['N']) {
      makeWall(seg, this.WALL_T, -((gap/2) + seg/2), -half + this.WALL_T/2);
      makeWall(seg, this.WALL_T,  ((gap/2) + seg/2), -half + this.WALL_T/2);
      this._buildDoorSet(node, 'N', group, h);
    } else {
      makeWall(size, this.WALL_T, 0, -half + this.WALL_T/2);
    }
    // South
    if (node.neighbors['S']) {
      makeWall(seg, this.WALL_T, -((gap/2) + seg/2),  half - this.WALL_T/2);
      makeWall(seg, this.WALL_T,  ((gap/2) + seg/2),  half - this.WALL_T/2);
      this._buildDoorSet(node, 'S', group, h);
    } else {
      makeWall(size, this.WALL_T, 0, half - this.WALL_T/2);
    }
    // West
    if (node.neighbors['W']) {
      makeWall(this.WALL_T, seg, -half + this.WALL_T/2, -((gap/2) + seg/2));
      makeWall(this.WALL_T, seg, -half + this.WALL_T/2,  ((gap/2) + seg/2));
      this._buildDoorSet(node, 'W', group, h);
    } else {
      makeWall(this.WALL_T, size, -half + this.WALL_T/2, 0);
    }
    // East
    if (node.neighbors['E']) {
      makeWall(this.WALL_T, seg, half - this.WALL_T/2, -((gap/2) + seg/2));
      makeWall(this.WALL_T, seg, half - this.WALL_T/2,  ((gap/2) + seg/2));
      this._buildDoorSet(node, 'E', group, h);
    } else {
      makeWall(this.WALL_T, size, half - this.WALL_T/2, 0);
    }

    node.group = group;
    node.cleared = (node.type === 'start');
    node.id = `${node.x},${node.y}`;
    this.rooms.push(node);
    this.roomByKey.set(node.id, node);
  }

  _buildDoorSet(node, dir, group, wallH) {
    const gap = this.DOOR_W;

    // Gate: solid blocker (visible only while locked)
    const gateW = (dir === 'N' || dir === 'S') ? gap : this.WALL_T;
    const gateD = (dir === 'N' || dir === 'S') ? this.WALL_T : gap;
    const gatePos = this._doorLocalOffset(dir).setY(wallH/2);
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.2, roughness: 0.7, emissive: 0x111827, emissiveIntensity: 0.08 });
    const gate = new THREE.Mesh(new THREE.BoxGeometry(gateW, wallH, gateD), gateMat);
    gate.position.copy(gatePos); gate.name = 'room_gate'; gate.visible = false;
    group.add(gate);

    // Shield: always present see-through barrier that blocks walk/bullets until E
    const shieldW = (dir === 'N' || dir === 'S') ? gap : this.WALL_T;
    const shieldD = (dir === 'N' || dir === 'S') ? this.WALL_T : gap;
    const shieldPos = this._doorLocalOffset(dir).setY(wallH/2);
    const shieldMat = new THREE.MeshStandardMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.15, metalness: 0.0, roughness: 1.0, emissive: 0x10b981, emissiveIntensity: 0.2 });
    const shield = new THREE.Mesh(new THREE.BoxGeometry(shieldW, wallH, shieldD), shieldMat);
    shield.position.copy(shieldPos); shield.name = 'door_shield'; shield.visible = true;
    group.add(shield);

    shield.userData.aabb = new THREE.Box3().setFromObject(shield);
    shield.userData.static = true;
    this.world.obstacles.push(shield);

    node.doors = node.doors || {};
    node.doors[dir] = { blocker: gate, shield: shield, to: node.neighbors[dir], dir };
  }

  _setCurrentRoom(room) {
    for (const r of this.rooms) r.group.visible = (r === room);
    this.currentRoom = room;
    this._renderMinimap();
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
    const pool = ['skitter','brute','bomber','sniper','turret','charger'];

    for (let i=0;i<melee;i++) this.world.spawnEnemyAt('melee', new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
    for (let i=0;i<ranged;i++) this.world.spawnEnemyAt('ranged', new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
    for (let i=0;i<extra;i++) this.world.spawnEnemyAt(pool[Math.floor(Math.random()*pool.length)], new THREE.Vector3(center.x + jitter(), 0, center.z + jitter()), 'room', room.id);
  }

  _startBossEncounter(room) {
    this._lockDoors(room);
    this.locked = true;
    const center = this._roomWorldCenter(room);
    const kinds = ['castle','pyramid','ice'];
    const pick = kinds[Math.floor(Math.random()*kinds.length)];
    this.world.castle = { center: center }; this.world.pyramid = { center: center }; this.world.icecave = { center: center };
    this.world._spawnBossFor(pick);
  }

  _spawnTreasure(room) {
    // Spawn 1–2 pedestals with rewards
    this._unlockDoors(room);
    const center = this._roomWorldCenter(room);
    const kinds = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun','weapon_smg','ammo_smg','crit','armor','haste'];
    const count = 1 + Math.floor(Math.random()*2);
    for (let i=0;i<count;i++) {
      const k = kinds[Math.floor(Math.random()*kinds.length)];
      const pos = new THREE.Vector3(center.x + (Math.random()-0.5)*6, 0, center.z + (Math.random()-0.5)*6);
      this._spawnPedestal(room, k, pos);
    }
    room.cleared = true;
  }

  _spawnRewardPedestal(room) {
    const center = this._roomWorldCenter(room);
    const rewards = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun','weapon_smg','ammo_smg','crit','armor','haste'];
    const k = rewards[Math.floor(Math.random()*rewards.length)];
    this._spawnPedestal(room, k, new THREE.Vector3(center.x, 0, center.z));
  }

  _spawnPedestal(room, kind, worldPos) {
    // Build as a group at worldPos so distance checks work
    const group = new THREE.Group();
    group.position.copy(worldPos);
    group.userData = { type: 'pedestal', kind, roomId: room.id, opened: false };
    group.name = 'pedestal_group';

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.9, metalness: 0.1 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.5, 12), baseMat);
    base.position.set(0, 0.25, 0);
    base.name = 'pedestal_base';

    const gemMat = new THREE.MeshStandardMaterial({ color: 0x93c5fd, emissive: 0x3b82f6, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), gemMat);
    gem.position.set(0, 1.0, 0);
    gem.name = 'pedestal_gem';

    group.add(base); group.add(gem);
    this.world.scene.add(group);

    // Add base as an obstacle so shots don't pass through
    base.userData.aabb = new THREE.Box3().setFromObject(base);
    base.userData.static = true;
    this.world.obstacles.push(base);

    this.pedestals.push({ mesh: group, kind, roomId: room.id, opened: false });
  }

  _removePedestal(p) {
    try {
      const base = p.mesh.children.find(c=>c.name==='pedestal_base');
      if (base) {
        const idx = this.world.obstacles.indexOf(base);
        if (idx >= 0) this.world.obstacles.splice(idx, 1);
      }
      this.world.scene.remove(p.mesh);
    } catch {}
    const i = this.pedestals.indexOf(p);
    if (i >= 0) this.pedestals.splice(i, 1);
  }

  _nearestPedestalWithin(playerPos, maxDist) {
    let best = null, bestD = maxDist;
    for (const p of this.pedestals) {
      if (p.opened) continue;
      const d = p.mesh.position.distanceTo(playerPos);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
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

  _markVisited(room) {
    this.visited.add(room.id);
    // Reveal neighbors
    this.revealed.add(room.id);
    for (const dir of ['N','S','W','E']) {
      const n = room.neighbors[dir];
      if (n) this.revealed.add(n.id);
    }
    this._renderMinimap();
  }

  _renderMinimap() {
    const cv = this.minimap;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,cv.width,cv.height);

    // Compute bounds
    let xs = [], ys = [];
    for (const r of this.rooms) { xs.push(r.x); ys.push(r.y); }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 8;
    const w = cv.width - pad*2, h = cv.height - pad*2;
    const spanX = Math.max(1, maxX - minX + 1);
    const spanY = Math.max(1, maxY - minY + 1);
    const cellW = Math.min(24, Math.min(w/spanX, h/spanY));

    const toXY = (rx, ry) => {
      const cx = pad + (rx - minX + 0.5)*cellW;
      const cy = pad + (ry - minY + 0.5)*cellW;
      return { x: cx, y: cy };
    };

    // Links
    ctx.lineWidth = 2;
    for (const r of this.rooms) {
      const a = toXY(r.x, r.y);
      for (const d of ['N','S','W','E']) {
        const n = r.neighbors[d];
        if (!n) continue;
        const b = toXY(n.x, n.y);
        ctx.strokeStyle = '#334155';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    // Nodes
    for (const r of this.rooms) {
      const p = toXY(r.x, r.y);
      const isVisited = this.visited.has(r.id);
      const isRevealed = this.revealed.has(r.id);
      if (!isRevealed) continue;

      ctx.beginPath();
      ctx.arc(p.x, p.y, cellW*0.3, 0, Math.PI*2);
      if (r === this.currentRoom) { ctx.fillStyle = '#38bdf8'; }
      else if (isVisited) { ctx.fillStyle = '#94a3b8'; }
      else { ctx.fillStyle = '#334155'; }
      ctx.fill();

      // Type marker
      if (r.type === 'boss') { ctx.fillStyle = '#f43f5e'; }
      else if (r.type === 'treasure') { ctx.fillStyle = '#fde047'; }
      else if (r.type === 'start') { ctx.fillStyle = '#22c55e'; }
      else { ctx.fillStyle = '#a78bfa'; }
      ctx.fillRect(p.x-2, p.y-2, 4, 4);
    }
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
    const offset = 3.0;
    const base = room.group.position.clone();
    if (dirIntoRoom === 'N') return base.add(new THREE.Vector3(0, 0, -this.ROOM_SIZE/2 + offset));
    if (dirIntoRoom === 'S') return base.add(new THREE.Vector3(0, 0,  this.ROOM_SIZE/2 - offset));
    if (dirIntoRoom === 'W') return base.add(new THREE.Vector3(-this.ROOM_SIZE/2 + offset, 0, 0));
    return base.add(new THREE.Vector3( this.ROOM_SIZE/2 - offset, 0, 0));
  }
  _roomOrigin(node) { return new THREE.Vector3(node.x * this.ROOM_SPACING, 0, node.y * this.ROOM_SPACING); }
  _roomWorldCenter(node) { return this._roomOrigin(node).clone(); }
  _manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  _oppositeDir(d) { return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'W' ? 'E' : 'W'; }
}
