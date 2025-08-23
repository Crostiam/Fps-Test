import * as THREE from 'three';

export class RoomManager {
  constructor(world, sound) {
    this.world = world;
    this.sound = sound;

    this.rooms = []; // {id,name,kind,entrancePos,entranceRadius,center,isBoss,state,wave, waves, barriers:[]}
    this.activeRoomId = null;
  }

  resetForFloor() {
    // Build or rebuild rooms from world lairs
    this.rooms.length = 0;
    let id = 1;

    if (this.world.castle) {
      const c = this.world.castle;
      const half = c.size / 2;
      // Entrance on north wall (towards -Z)
      const entrancePos = new THREE.Vector3(c.center.x, 0, c.center.z - half - 1.2);
      this.rooms.push({
        id: id++, name: 'Warlord Keep', kind: 'castle',
        center: c.center.clone(), entrancePos, entranceRadius: 3.0,
        isBoss: true, state: 'idle', wave: 0, waves: 1, barriers: []
      });
    }
    if (this.world.pyramid) {
      const p = this.world.pyramid; const half = p.size / 2;
      const entrancePos = new THREE.Vector3(p.center.x, 0, p.center.z - half - 1.5);
      this.rooms.push({
        id: id++, name: 'Pharaoh Tomb', kind: 'pyramid',
        center: p.center.clone(), entrancePos, entranceRadius: 3.0,
        isBoss: false, state: 'idle', wave: 0, waves: 2, barriers: []
      });
    }
    if (this.world.icecave) {
      const i = this.world.icecave; const half = i.size / 2;
      const entrancePos = new THREE.Vector3(i.center.x, 0, i.center.z - half - 1.5);
      this.rooms.push({
        id: id++, name: 'Frozen Grotto', kind: 'ice',
        center: i.center.clone(), entrancePos, entranceRadius: 3.0,
        isBoss: false, state: 'idle', wave: 0, waves: 2, barriers: []
      });
    }

    // Remove any leftover barriers
    for (const r of this.rooms) r.barriers = [];
    this.activeRoomId = null;
  }

  getActiveRoomId() {
    return this.activeRoomId;
  }

  // Create/remove a simple axis-aligned barrier box across a doorway
  _addBarrierAt(x, z, w, h = 4, t = 0.6) {
    return this.world.addBarrier(new THREE.Vector3(x, h/2, z), w, h, t);
  }
  _clearBarriers(room) {
    for (const b of room.barriers) this.world.removeBarrier(b);
    room.barriers.length = 0;
  }

  _lockRoom(room) {
    // Place two barriers just inside and just outside the gate line (assume north wall)
    const gateWidth = 6.0; // wide enough to cover gap
    const lineZ = room.entrancePos.z + 1.2; // just inside
    const outerZ = room.entrancePos.z + 0.2; // just outside
    const b1 = this._addBarrierAt(room.entrancePos.x, lineZ, gateWidth);
    const b2 = this._addBarrierAt(room.entrancePos.x, outerZ, gateWidth);
    room.barriers.push(b1, b2);
    room.state = 'locked';
    this.activeRoomId = room.id;
  }
  _unlockRoom(room) {
    this._clearBarriers(room);
    room.state = 'cleared';
    this.activeRoomId = null;
  }

  _spawnWave(room) {
    room.wave += 1;

    if (room.isBoss) {
      // Spawn boss tied to this room
      const boss = this.world.spawnBoss(room.kind);
      if (boss) boss.userData.roomId = room.id;
      return;
    }

    // Normal room waves: scale by floor
    const floor = this.world.floor || 1;
    const baseMelee = 3 + Math.floor((floor - 1) * 0.8);
    const baseRanged = 2 + Math.floor((floor - 1) * 0.6);
    const countM = baseMelee + (room.wave - 1);
    const countR = baseRanged + (room.wave - 1);

    // Spawn around room center
    const spawns = [];
    const center = room.center.clone();
    for (let i=0;i<countM;i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 8;
      const pos = new THREE.Vector3(center.x + Math.cos(ang)*r, 1, center.z + Math.sin(ang)*r);
      spawns.push({ kind: 'melee', pos });
    }
    for (let i=0;i<countR;i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 10;
      const pos = new THREE.Vector3(center.x + Math.cos(ang)*r, 1, center.z + Math.sin(ang)*r);
      spawns.push({ kind: 'ranged', pos });
    }

    for (const s of spawns) {
      this.world.spawnEnemy(s.kind, s.pos, room.id);
    }
  }

  _maybeRoomCleared(room) {
    const remaining = this.world.getRoomEnemyCount(room.id);
    if (room.isBoss) {
      // Boss death triggers portal via World; treat room as cleared when no enemies left
      if (remaining === 0) {
        this._unlockRoom(room);
        // Reward options (powerups) near center
        this._spawnRoomRewards(room);
      }
      return;
    }

    if (remaining === 0) {
      if (room.wave < room.waves) {
        // Next wave
        this._spawnWave(room);
      } else {
        // Cleared
        this._unlockRoom(room);
        this._spawnRoomRewards(room);
      }
    }
  }

  _spawnRoomRewards(room) {
    const options = ['health', 'shield', 'damage', 'firerate', 'ammo_rifle', 'ammo_shotgun', 'weapon_rifle', 'weapon_shotgun'];
    // pick 3 distinct
    const picks = [];
    while (picks.length < 3 && options.length > 0) {
      const i = Math.floor(Math.random() * options.length);
      picks.push(options.splice(i, 1)[0]);
    }
    const base = room.center.clone();
    const offsets = [new THREE.Vector3(-1.2, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.2, 0, 0)];
    for (let i=0;i<picks.length;i++) {
      const pos = base.clone().add(offsets[i]);
      this.world.spawnPowerupAt(picks[i], pos);
    }
  }

  update(dt, playerPos, interacted) {
    // If in a locked room, keep checking clear condition
    if (this.activeRoomId !== null) {
      const room = this.rooms.find(r => r.id === this.activeRoomId);
      if (room && room.state === 'locked') {
        this._maybeRoomCleared(room);
      }
    }

    // If not in a room, check for nearby entrances
    let hint = null;
    if (this.activeRoomId === null) {
      for (const room of this.rooms) {
        if (room.state === 'idle') {
          const d = room.entrancePos.distanceTo(playerPos);
          if (d < room.entranceRadius) {
            hint = 'Press E to enter: ' + room.name;
            if (interacted) {
              this._lockRoom(room);
              this._spawnWave(room);
              break;
            }
          }
        }
      }
    }
    return hint; // may be null
  }
}
