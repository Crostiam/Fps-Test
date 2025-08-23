# Web FPS Roguelike (Isaac‑style Rooms)

Fast, lightweight, Three.js FPS roguelike that plays out across a grid of connected rooms (in the spirit of “The Binding of Isaac”). You navigate via doors, clear combat rooms, grab treasure from pedestals, fight a boss each floor, and descend via a portal. Minimal assets, all runtime geometry, with built‑in SFX/music via WebAudio.

Highlights
- Procedural floor layout with start, combat, treasure, and boss rooms
- See‑through door shields: view into the next room, but shots/players can’t pass until you press E
- Locking encounters: doors shut while fighting and reopen on clear
- Reward pedestals: interact with E; clear treasure and combat rewards reliably
- Bosses: defeat spawns a portal; you’re returned to the Start room and the portal appears there
- Minimap with fog‑of‑war: shows current, visited, and adjacent revealed rooms
- Weapons: Pistol, Rifle, Shotgun, SMG (auto rifles/SMG while holding LMB)
- Powerups: Damage, Fire Rate, Shield, Crit, Armor, Haste; ammo and weapon unlocks
- Enemies: melee, ranged, skitter, brute, sniper, bomber, turret, charger; plus 3 boss archetypes
- Home Upgrades shop: spend gold between runs on meta progression
- Built‑in SFX and ambient/music pad using WebAudio; master volume slider on Home/Pause

---

## Controls

- Move: WASD
- Jump: Space
- Sprint: Left Shift
- Look: Mouse
- Fire: Left Mouse Button (hold for auto weapons)
- Reload: R
- Interact: E
  - Doors: press E at a door shield to enter the next room
  - Pedestals: press E near a pedestal to claim the reward
- Switch weapons: 1/2/3/4 (Pistol/Rifle/Shotgun/SMG)
- Pause: P or Escape
- Start Run: Click “Start Run” on the Home screen

Tip: the HUD “hint” at the bottom shows contextual prompts (e.g., “Press E to enter Room” or “Press E to pick up: Damage Boost”).

---

## How It Plays

- Start Room: Safe room; doors are unlocked here.
- Doors:
  - Each doorway has a see‑through shield that blocks your shots and movement.
  - Press E while near the shield to enter the next room (and teleport just inside it).
- Combat Rooms:
  - Doors lock and a wave spawns. Clear all enemies to unlock doors.
  - A reward pedestal appears in the room when cleared.
- Treasure Rooms:
  - Always contain at least one guaranteed weapon pedestal (Rifle/Shotgun/SMG), plus optional utility pedestal.
- Boss Room:
  - Defeat the boss to complete the floor.
  - You are teleported back to the Start room and a portal appears there.
  - Enter the portal to generate the next floor.
- Gold:
  - Drops from enemies and targets; auto‑magnetizes to you and auto‑collects.
  - Added to your wallet on run end (death or Abort Run).
  - Spend wallet gold on the Home screen in the Upgrades shop.

---

## Weapons & Powerups

Weapons
- Pistol: Infinite ammo, semi‑auto baseline
- Rifle: Auto, mid damage, 30‑round mag
- Shotgun: Semi‑auto, pellet spread, 6‑round mag
- SMG: Auto, high fire rate, low damage, 40‑round mag

Ammo Types
- Rifle Ammo, Shotgun Ammo, SMG Ammo increase reserve; reload with R

Temporary Powerups
- Damage: +60% damage (timed)
- Fire Rate: +60% fire rate (timed)
- Shield: Temporary invulnerability (timed)
- Crit: ~22% chance to deal double damage (timed)
- Armor: ~20% damage reduction (timed)
- Haste: +25% movement speed (timed)

Permanent Meta Upgrades (Home Shop)
- Max Health +10 (stacking), Damage +6%, Fire Rate +6%, Speed +4%
- Start with Rifle, Start with Shotgun
- Purchased with wallet gold; persist via localStorage across runs

---

## Enemies

Regular
- Melee: Close‑range chaser
- Ranged: Medium range, strafes and shoots
- Skitter: Small, fast chaser
- Brute: Large, slow, heavy contact damage
- Sniper: Long range, high damage shots
- Bomber: Keeps distance, lobs heavy slow shots
- Turret: Stationary shooter
- Charger: Fast melee with slightly longer reach

Bosses
- Three archetypes with different shooting patterns (bursts, spreads, rings)
- After kill: portal to next floor is moved to the Start room; you’re teleported there

---

## Minimap

- Location: Top‑right
- Current room: Blue
- Visited rooms: Light gray
- Revealed adjacent rooms: Darker gray
- Room types:
  - Start: Green dot
  - Treasure: Yellow dot
  - Boss: Red dot
  - Combat/other: Purple dot

Rooms you’ve visited remain on the map; neighbors of your current room are revealed so you can route.

---

## Audio

- SFX for shots, hits, reloads, coins, footsteps (WebAudio)
- Ambient noise bed + simple evolving synth pad for background music
- Master Volume slider on Home and Pause; settings apply immediately

If your browser blocks audio autoplay, sound starts on first click (e.g., Start Run).

---

## Persisted Data

- Stored in localStorage under the key `fps-roguelike-profile`
- Persists:
  - Wallet Gold (meta currency)
  - Purchased Upgrades (Max Health, Damage, Fire Rate, Speed, Start weapons)

To reset progress, delete this key in DevTools.

---

## Running the Project

This project uses ES modules and imports from `three`/`three/examples`, so a dev server/bundler is recommended.

Quick start with Vite (recommended)
1. Ensure Node.js 18+ is installed.
2. Install dev dependency and add scripts (if not already present):
   ```json
   // package.json (example)
   {
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview"
     },
     "devDependencies": {
       "vite": "^5.0.0"
     },
     "dependencies": {
       "three": "^0.165.0"
     }
   }
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the printed local URL (usually http://localhost:5173).

Alternative
- Any static server that resolves bare imports (e.g., using a bundler) works. If you prefer Parcel/Webpack, configure to handle ES modules and `three/examples` imports.

---

## Project Structure (key files)

- `index.html` — UI overlays (Home, Pause, Death, Reward picker), HUD, minimap canvas
- `src/main.js` — game loop, input/controls, UI flows, weapons, timers, progression, interactions
- `src/World.js` — world entities and systems: enemies, projectiles, collisions, powerups, gold, portals, SFX tracers
- `src/RoomManager.js` — procedural room graph, room meshes, doors/gates/shields, encounters, pedestals, boss flow, minimap
- `src/Sound.js` — WebAudio SFX + ambient/music
- `src/Input.js` — keyboard state (WASD, jump, sprint, etc.)

---

## Known Behaviors / Tips

- Can’t leave or shoot through doors without pressing E: by design. Shields keep the next room “alive” without cross‑room cheesing.
- After killing the boss you’re moved to the Start room and the portal appears there.
- If enemies “stop damaging you,” you may be under Shield. The blue shield effect is time‑limited and ticks down; you’re damageable once it expires.
- Pedestals show “Press E to pick up: <name>” when you’re in range; they don’t auto‑pickup.

---

## Roadmap Ideas

- Shop room type (priced pedestals using run gold)
- More weapon archetypes (beam, launcher, charge rifle)
- Room modifiers (hazards, traps, elites)
- Boss telegraph FX and unique loot unlocks
- Settings: keybinds, FOV slider, colorblind indicators

Contributions and suggestions welcome.

---

## License

MIT (or your preferred license here)
