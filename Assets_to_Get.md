# Low‑poly assets to download and where to place them

All suggested packs below are CC0 (public domain) and very lightweight. Put the files under public/assets using the exact target paths shown so the manifest resolves.

Weapons (world/pedestal pickups work fine; FP guns also acceptable)
- Source (CC0): Quaternius – Simple Weapons Pack
  URL: https://quaternius.com/packs/simpleweapons.html
  Files to use (GLTF/GLB):
  - Rifle.glb → /assets/models/weapons/rifle_world.glb
  - Shotgun.glb → /assets/models/weapons/shotgun_world.glb
  - SMG.glb → /assets/models/weapons/smg_world.glb
  Optional (first‑person variants): you can reuse the same files for FP if you like
  - Rifle.glb → /assets/models/weapons_fp/rifle_fp.glb
  - Shotgun.glb → /assets/models/weapons_fp/shotgun_fp.glb
  - SMG.glb → /assets/models/weapons_fp/smg_fp.glb
  - Pistol.glb → /assets/models/weapons_fp/pistol_fp.glb

Enemies (pick a few you like; names can vary per pack)
- Source (CC0): Quaternius – Simple Monsters Pack
  URL: https://quaternius.com/packs/simplemonsters.html
  Suggested files:
  - Monster01.glb → /assets/models/enemies/melee.glb
  - Monster02.glb → /assets/models/enemies/ranged.glb
  - Monster03.glb → /assets/models/enemies/skitter.glb
  - Monster04.glb → /assets/models/enemies/brute.glb
  - Monster05.glb → /assets/models/enemies/sniper.glb
  - Monster06.glb → /assets/models/enemies/bomber.glb
  - Monster07.glb → /assets/models/enemies/turret.glb
  - Monster08.glb → /assets/models/enemies/charger.glb

Bosses (pick any three distinct silhouettes)
- Reuse 3 monsters at larger scale OR grab Quaternius’ Simple Bosses (if available) and map as:
  - BossA.glb → /assets/models/bosses/castle.glb
  - BossB.glb → /assets/models/bosses/pyramid.glb
  - BossC.glb → /assets/models/bosses/ice.glb

Props
- Pedestal:
  - Source (CC0): Kenney – Prototype Textures/Props or any low‑poly column/pedestal
  - pedestal.glb → /assets/models/props/pedestal.glb
- Door frame:
  - Low‑poly doorway/frame from any CC0 pack
  - door_frame.glb → /assets/models/props/door_frame.glb
- Portal (optional):
  - Any low‑poly ring/portal mesh
  - portal.glb → /assets/models/fx/portal.glb

Pickup models (optional, to visually show the reward type)
- You can reuse weapon models and a few icons for buffs:
  - /assets/models/pickups/rifle_world.glb → weapon_rifle
  - /assets/models/pickups/shotgun_world.glb → weapon_shotgun
  - /assets/models/pickups/smg_world.glb → weapon_smg
  For utility pickups, any small icon mesh (heart, shield, bolt, etc.) works:
  - heart.glb → /assets/models/pickups/health.glb
  - shield.glb → /assets/models/pickups/shield.glb
  - bolt.glb → /assets/models/pickups/firerate.glb
  - sword.glb → /assets/models/pickups/damage.glb
  - bullet_box.glb → /assets/models/pickups/ammo_rifle.glb
  - shell_box.glb → /assets/models/pickups/ammo_shotgun.glb
  - smg_ammo_box.glb → /assets/models/pickups/ammo_smg.glb
  - star.glb → /assets/models/pickups/crit.glb
  - vest.glb → /assets/models/pickups/armor.glb
  - wing.glb → /assets/models/pickups/haste.glb

Room textures (optional; keep tiny for performance)
- Floor/wall basecolor 512–1k textures (CC0)
  - /assets/textures/floor_basecolor.jpg
  - /assets/textures/wall_basecolor.jpg

Tips
- Keep polycounts small and materials simple (1–2 materials per mesh).
- If a model imports too big, rescale in Blender and re‑export GLB.
- If you don’t provide a given file, the game falls back to primitive shapes automatically.
