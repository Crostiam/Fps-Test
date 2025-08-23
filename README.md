# Web FPS Starter (Three.js + Vite)

A minimal, fast first-person shooter starter you can host on GitHub Pages.

- WASD to move, mouse to look
- Click to shoot spinning targets
- Jump (Space), Sprint (Shift)
- Web-optimized defaults (no MSAA, capped pixel ratio, relative asset paths)
- Auto-deploy to GitHub Pages via Actions

## Quick start

```bash
# Install dependencies
npm install

# Run locally
npm run dev
```

Open the URL Vite prints (e.g., http://localhost:5173/), click "Click to Play" to lock the cursor.

## Deploy to GitHub Pages

1. Push to the `main` branch.
2. In your repo: Settings → Pages → Build and deployment → Source: "GitHub Actions".
3. The included workflow builds and deploys `dist/` automatically.
4. Your game will be available at:  
   `https://<your-username>.github.io/<repo-name>/`

Vite is configured with `base: './'` and index.html uses `./src/main.js` so it works under `/repo-name/`.

## Project structure

```
.
├─ src/
│  ├─ main.js        # game loop, camera, player movement, shooting
│  ├─ Input.js       # keyboard state
│  └─ World.js       # scene setup, targets, collisions
├─ index.html
├─ vite.config.js
├─ package.json
└─ .github/workflows/deploy.yml
```

## Performance & optimization notes

- Renderer:
  - `antialias: false`, pixelRatio capped to `<= 1.5`
  - `powerPreference: 'high-performance'`
- Avoid per-frame allocations; reuse vectors where possible.
- Use hitscan (raycast) for shooting rather than spawning projectiles.
- Keep materials simple; prefer `MeshStandardMaterial` with modest lighting.
- Consider:
  - Object pooling for effects
  - Texture compression (KTX2 / Basis) if you add assets
  - Instancing for many similar targets
  - Frustum culling (enabled by default in Three.js)
  - LODs for large scenes
- Measure! Use devtools performance, Spector.js for WebGL, and an in-game FPS meter.

## Extending

- Add enemies with basic AI (seek player within radius)
- Add projectile weapons (pooling) and hit decals
- Add a simple UI for health, timer, or waves
- Add sound (`Howler.js` or Web Audio)
- Add a map loader or procedural level

## License

MIT — see LICENSE.
