import * as THREE from 'three';

export class RoomManager {
  constructor(world, sound, applyPickupFn) {
    this.world = world;
    this.sound = sound;
    this.applyPickup = applyPickupFn;

    this.rooms = []; // { id, kind, entryPos, center, size, height, cleared, gate }
    this.currentRoomId = null;
    this.gatesGroup = new THREE.Group();
    this.world.lairGroup.add(this.gatesGroup);

    this._buildRoomsFromLair(); // note: only one lair now
    this._cacheUI();
  }

  _cacheUI() {
    this.rewardOverlay = document.getElementById('rewardOverlay');
    this.rewardCards = document.getElementById('rewardCards');
    this.skipRewardBtn = document.getElementById('skipRewardBtn');
  }

  _buildRoomsFromLair() {
    // World now builds only one lair; add it as a single room
    const lairs = [this.world.castle, this.world.pyramid, this.world.icecave].filter(Boolean);
    if (lairs.length === 0) return;
    const lair = lairs[0];
    const center = lair.center.clone();
    const entry = new THREE.Vector3(center.x, 0, center.z - lair.size / 2 + (lair.wallT || 1.0) + 0.5);
    this.rooms.push(this._makeRoom(lair.group.name || 'lair', center, lair.size, lair.height || 6, entry));
  }

  _makeRoom(kind, center, size, height, entryPos) {
    const id = `${Math.round(center.x)}-${Math.round(center.z)}`;
    const gate = this._buildGateAt(entryPos, height);
    return { id, kind, center, size, height, entryPos, cleared: false, gate };
  }

  _buildGateAt(entryPos, height) {
    const w = 4.6, t = 0.4, h = Math.max(3.5, height * 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.2, roughness: 0.7, emissive: 0x111827, emissiveIntensity: 0.1 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
    m.position.set(entryPos.x, h/2, entryPos.z + 0.1);
    m.visible = false;
    m.name = 'room_gate';
    this.gatesGroup.add(m);
    return m;
  }

  getEnterableRoom(playerPos, maxDist = 2.2) {
    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      if (r.cleared) continue;
      if (playerPos.distanceTo(r.entryPos) <= maxDist) return r;
    }
    return null;
  }

  isInRoom() {
    return this.currentRoomId !== null;
  }

  enterRoom(room) {
    if (!room || this.currentRoomId) return;
    this.currentRoomId = room.id;

    // Close gate and add to obstacles
    if (room.gate) {
      room.gate.visible = true;
      room.gate.userData = room.gate.userData || {};
      room.gate.userData.aabb = new THREE.Box3().setFromObject(room.gate);
      room.gate.userData.static = true;
      this.world.obstacles.push(room.gate);
    }

    // Pause overworld
    this.world.setAmbientActive(false);
    this.world.inRoom = true;

    // Spawn wave inside the room
    const radius = Math.max(6, room.size * 0.35);
    // Mix scales with floor
    const f = this.world.floor;
    const melee = 3 + Math.floor((f - 1) * 1.2);
    const ranged = 2 + Math.floor((f - 1) * 0.8);
    const extra = Math.floor((f) / 2); // add variety types
    this._spawnRoomWave(room, melee, ranged, extra, radius);
  }

  _spawnRoomWave(room, melee, ranged, extra, radius) {
    const center = room.center;
    const jitter = () => ((Math.random() - 0.5) * radius) * 0.9;

    const spawnAt = (kind) => {
      const p = new THREE.Vector3(center.x + jitter(), 0, center.z + jitter());
      this.world.spawnEnemyAt(kind, p, 'room', room.id);
    };

    for (let i = 0; i < melee; i++) spawnAt('melee');
    for (let i = 0; i < ranged; i++) spawnAt('ranged');

    const pool = ['skitter','brute','bomber','sniper'];
    for (let i = 0; i < extra; i++) {
      spawnAt(pool[Math.floor(Math.random()*pool.length)]);
    }
  }

  update(dt) {
    if (!this.currentRoomId) return;

    let remaining = 0;
    for (let i = 0; i < this.world.enemies.length; i++) {
      const e = this.world.enemies[i];
      if (e.userData && e.userData.scope === 'room' && e.userData.roomId === this.currentRoomId) {
        remaining++; break;
      }
    }

    if (remaining === 0 && !this.world.activeBoss) {
      const room = this.rooms.find(r => r.id === this.currentRoomId);
      if (room) room.cleared = true;

      // Open gate and remove obstacle
      if (room && room.gate) {
        room.gate.visible = false;
        const idx = this.world.obstacles.indexOf(room.gate);
        if (idx >= 0) this.world.obstacles.splice(idx, 1);
      }

      // Show reward picker
      this._presentRewardPicker(() => {
        // After pick (or skip), resume overworld
        this.world.inRoom = false;
        this.world.setAmbientActive(true);
        this.currentRoomId = null;
      });
    }
  }

  _presentRewardPicker(done) {
    const overlay = this.rewardOverlay;
    const container = this.rewardCards;
    if (!overlay || !container) { done(); return; }

    const rewards = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun'];
    // pick 3 distinct
    const picks = [];
    while (picks.length < 3 && rewards.length) {
      const i = Math.floor(Math.random()*rewards.length);
      const k = rewards.splice(i,1)[0];
      picks.push(k);
    }

    container.innerHTML = '';
    const makeCard = (kind, title, desc) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<h3>${title}</h3><p>${desc}</p>`;
      div.addEventListener('click', () => {
        overlay.style.display = 'none';
        // apply reward immediately
        this.applyPickup(kind);
        // request pointer lock back
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
        done();
      });
      return div;
    };
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

    for (let i=0;i<picks.length;i++) {
      const k = picks[i];
      const [t,d] = labels[k] || ['Reward','Take this!'];
      container.appendChild(makeCard(k, t, d));
    }

    this.skipRewardBtn.onclick = () => {
      overlay.style.display = 'none';
      const canvas = document.querySelector('canvas');
      if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
      done();
    };

    // Show overlay and exit pointer lock for UI interaction
    overlay.style.display = 'grid';
    if (document.exitPointerLock) document.exitPointerLock();
  }
}
