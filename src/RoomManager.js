import * as THREE from 'three';

export class RoomManager {
  constructor(world, sound) {
    this.world = world;
    this.sound = sound;

    this.rooms = []; // { id, kind, entryPos:Vector3, center:Vector3, size:number, height:number, cleared:boolean, gate:Mesh|null }
    this.currentRoomId = null;
    this.gatesGroup = new THREE.Group();
    this.world.lairGroup.add(this.gatesGroup);

    this._buildRoomsFromLairs();
  }

  _buildRoomsFromLairs() {
    // Castle
    if (this.world.castle && this.world.castle.center) {
      const lair = this.world.castle;
      const entry = new THREE.Vector3(lair.center.x, 0, lair.center.z - lair.size / 2 + lair.wallT + 0.5);
      this.rooms.push(this._makeRoom('castle', lair.center.clone(), lair.size, lair.height, entry));
    }
    // Pyramid
    if (this.world.pyramid && this.world.pyramid.center) {
      const lair = this.world.pyramid;
      const entry = new THREE.Vector3(lair.center.x, 0, lair.center.z - lair.size / 2 + 1.2);
      this.rooms.push(this._makeRoom('pyramid', lair.center.clone(), lair.size, lair.height, entry));
    }
    // Ice cave
    if (this.world.icecave && this.world.icecave.center) {
      const lair = this.world.icecave;
      const entry = new THREE.Vector3(lair.center.x, 0, lair.center.z - lair.size / 2 + 1.2);
      this.rooms.push(this._makeRoom('ice', lair.center.clone(), lair.size, lair.height, entry));
    }
  }

  _makeRoom(kind, center, size, height, entryPos) {
    const id = `${kind}-${Math.round(center.x)}-${Math.round(center.z)}`;
    const gate = this._buildGateAt(entryPos, height);
    return { id, kind, center, size, height, entryPos, cleared: false, gate };
  }

  _buildGateAt(entryPos, height) {
    // A simple rectangular blocker toggled during combat
    const w = 4.6, t = 0.4, h = Math.max(3.5, height * 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.2, roughness: 0.7, emissive: 0x111827, emissiveIntensity: 0.1 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
    m.position.set(entryPos.x, h/2, entryPos.z + 0.1);
    m.rotation.y = 0;
    m.visible = false;
    m.name = 'room_gate';
    this.gatesGroup.add(m);
    return m;
  }

  getEnterableRoom(playerPos, maxDist = 2.2) {
    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      if (r.cleared) continue;
      const d = playerPos.distanceTo(r.entryPos);
      if (d <= maxDist) return r;
    }
    return null;
  }

  isInRoom() {
    return this.currentRoomId !== null;
  }

  enterRoom(room) {
    if (!room || this.currentRoomId) return;
    this.currentRoomId = room.id;

    // Close gate and add as obstacle
    if (room.gate) {
      room.gate.visible = true;
      room.gate.userData = room.gate.userData || {};
      room.gate.userData.aabb = new THREE.Box3().setFromObject(room.gate);
      room.gate.userData.static = true;
      this.world.obstacles.push(room.gate);
    }

    // Pause overworld; mark inRoom
    this.world.setAmbientActive(false);
    this.world.inRoom = true;

    // Spawn a simple wave inside the room
    const radius = Math.max(6, room.size * 0.35);
    const melee = 4 + Math.floor((this.world.floor - 1) * 1.2);
    const ranged = 2 + Math.floor((this.world.floor - 1) * 0.8);
    this._spawnRoomWave(room, melee, ranged, radius);
  }

  _spawnRoomWave(room, melee, ranged, radius) {
    const center = room.center;
    const jitter = () => ((Math.random() - 0.5) * radius) * 0.9;
    for (let i = 0; i < melee; i++) {
      const p = new THREE.Vector3(center.x + jitter(), 0, center.z + jitter());
      this.world.spawnEnemyAt('melee', p, 'room', room.id);
    }
    for (let i = 0; i < ranged; i++) {
      const p = new THREE.Vector3(center.x + jitter(), 0, center.z + jitter());
      this.world.spawnEnemyAt('ranged', p, 'room', room.id);
    }
  }

  update(dt) {
    if (!this.currentRoomId) return;

    // Check if any room-scoped enemies remain
    let remaining = 0;
    for (let i = 0; i < this.world.enemies.length; i++) {
      const e = this.world.enemies[i];
      if (e.userData && e.userData.scope === 'room' && e.userData.roomId === this.currentRoomId) {
        remaining++;
        break;
      }
    }

    if (remaining === 0 && !this.world.activeBoss) {
      // Clear current room
      const room = this.rooms.find(r => r.id === this.currentRoomId);
      if (room) room.cleared = true;

      // Open gate and remove obstacle
      if (room && room.gate) {
        room.gate.visible = false;
        // remove from obstacles
        const idx = this.world.obstacles.indexOf(room.gate);
        if (idx >= 0) this.world.obstacles.splice(idx, 1);
      }

      // Reward: spawn 1 guaranteed powerup at center
      const rewards = ['health','shield','damage','firerate','ammo_rifle','ammo_shotgun','weapon_rifle','weapon_shotgun'];
      const kind = rewards[Math.floor(Math.random()*rewards.length)];
      const mesh = this.world._makePowerupMesh(kind);
      mesh.position.set(room.center.x, 0.6, room.center.z);
      mesh.userData = { type: 'powerup', kind: kind, spin: Math.random()*Math.PI*2, label: this.world._powerupLabel(kind) };
      this.world.powerupGroup.add(mesh);

      // Resume overworld
      this.world.inRoom = false;
      this.world.setAmbientActive(true);
      this.currentRoomId = null;
    }
  }
}
