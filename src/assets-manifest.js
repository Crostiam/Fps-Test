// Low-poly asset manifest (local-first). Put files under public/assets as described in ASSETS_TO_GET.md.
// You can comment out any line you don't have yet; the engine will gracefully fall back.

export const ASSET_MANIFEST = {
  models: {
    // First-person weapons (attach to camera)
    'gun_pistol_fp':  '/assets/models/weapons_fp/pistol_fp.glb',
    'gun_rifle_fp':   '/assets/models/weapons_fp/rifle_fp.glb',
    'gun_shotgun_fp': '/assets/models/weapons_fp/shotgun_fp.glb',
    'gun_smg_fp':     '/assets/models/weapons_fp/smg_fp.glb',

    // World pickups/items shown on pedestals
    'pickup_weapon_rifle':  '/assets/models/weapons/rifle_world.glb',
    'pickup_weapon_shotgun':'/assets/models/weapons/shotgun_world.glb',
    'pickup_weapon_smg':    '/assets/models/weapons/smg_world.glb',
    'pickup_health':   '/assets/models/pickups/health.glb',
    'pickup_shield':   '/assets/models/pickups/shield.glb',
    'pickup_damage':   '/assets/models/pickups/damage.glb',
    'pickup_firerate': '/assets/models/pickups/firerate.glb',
    'pickup_ammo_rifle':'/assets/models/pickups/ammo_rifle.glb',
    'pickup_ammo_shotgun':'/assets/models/pickups/ammo_shotgun.glb',
    'pickup_ammo_smg': '/assets/models/pickups/ammo_smg.glb',
    'pickup_crit':     '/assets/models/pickups/crit.glb',
    'pickup_armor':    '/assets/models/pickups/armor.glb',
    'pickup_haste':    '/assets/models/pickups/haste.glb',

    // Props
    'pedestal':    '/assets/models/props/pedestal.glb',
    'door_frame':  '/assets/models/props/door_frame.glb',

    // Enemies (centered at origin; engine lifts to ground)
    'enemy_melee':   '/assets/models/enemies/melee.glb',
    'enemy_ranged':  '/assets/models/enemies/ranged.glb',
    'enemy_skitter': '/assets/models/enemies/skitter.glb',
    'enemy_brute':   '/assets/models/enemies/brute.glb',
    'enemy_sniper':  '/assets/models/enemies/sniper.glb',
    'enemy_bomber':  '/assets/models/enemies/bomber.glb',
    'enemy_turret':  '/assets/models/enemies/turret.glb',
    'enemy_charger': '/assets/models/enemies/charger.glb',

    // Bosses
    'boss_castle':  '/assets/models/bosses/castle.glb',
    'boss_pyramid': '/assets/models/bosses/pyramid.glb',
    'boss_ice':     '/assets/models/bosses/ice.glb',

    // Portal
    'portal': '/assets/models/fx/portal.glb',
  },
  textures: {
    'room_floor': '/assets/textures/floor_basecolor.jpg',
    'room_wall':  '/assets/textures/wall_basecolor.jpg',
  },
  audio: {
    // Optionally place custom audio here; engine falls back to built-in SFX/music
    // 'pickup_custom': '/assets/audio/pickup.wav'
  }
};
