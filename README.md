# Stonebound Gambit

**Stonebound Gambit** is a browser-based 3D chess game set inside a subterranean, torch-lit stone chamber. Carved limestone and basalt pieces clash across an obsidian-and-marble board with physics-driven shatter captures, spoken voice commands, procedural Web Audio sound design, and a Stockfish WebAssembly opponent.

---

## Features

- **3D Chess & Chamber Atmosphere**: Full FIDE chess rules (`chess.js` — castling, en passant, pawn promotion, check, checkmate, stalemate, threefold repetition, insufficient material, and 50-move draw detection) rendered in Three.js with carved silhouettes for all six piece types, procedural stone textures, sequential flickering braziers, moonlight fog, shadows, and bloom/vignette post-processing. Play **Single Player** (White vs. Black AI) or **Two Players** (local pass-and-play).
- **Stockfish AI with 3 Difficulties**: Runs `stockfish` (WebAssembly) in a dedicated Web Worker with **Easy**, **Medium**, and **Hard** difficulty presets mapped to skill level, search depth, and move time—plus an automatic alpha-beta minimax fallback if the worker cannot be initialized.
- **Voice Commands**: Optional browser Web Speech API input supporting spoken chess commands (e.g., `"Pawn to E4"`, `"Knight to F3"`, `"Castle kingside"`, `"Pawn to E8 promote to Queen"`).
- **Physics-Based Captures**: Attacking pieces perform class-specific strikes (slam, sweep, thrust, or Knight rearing leap) as captured pieces shatter into rigid-body `cannon-es` stone shards that scatter across the board and sunken perimeter trench alongside dust bursts, impact flashes, and camera shake.
- **Checkmate Sequence**: When a king is checkmated, the camera pushes in while the defeated king kneels, its detached crown drops and bounces across the stone, and the iron-bound dungeon exit doors unlock in golden light before the Checkmate overlay fades in. Kings in check also pulse with a warning glow.
- **Synthesized Web Audio**: 100% procedural Web Audio API soundscape (no external audio files) including sliding stone scrapes, landing thuds, capture impact slams, rock-shatter bursts, randomized shard clatter, looping chamber wind & hearth fire crackle ambience, a dynamic check warning drone that intensifies on repeated/tight checks, crown clangs, brazier whooshes, and door-unlock groans—with HUD mute, master, effects, and ambience volume controls.

---

## Tech Stack

- **UI & Framework**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons
- **3D Rendering & Post-Processing**: Three.js, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (`Bloom`, `Vignette`, `ToneMapping`)
- **Physics**: `@react-three/cannon` & `cannon-es`
- **Chess Rules & Engine**: `chess.js`, `stockfish` (WASM Web Worker) + custom alpha-beta minimax fallback
- **Audio & Input**: Browser Web Audio API & Web Speech API

---

## Setup

### Prerequisites
- Node.js (v18+ recommended) and npm

### Installation & Scripts

```bash
# Install dependencies
npm install

# Start the development server (runs on http://localhost:3000)
npm run dev

# Build for production
npm run build
```

You can also run typechecking with `npm run lint` (`tsc --noEmit`) or preview a production build with `npm run preview`.

---

## Controls

- **Select & Move Pieces**: Click a piece of the active color to highlight its legal moves, then click a highlighted destination square to move. Selecting a pawn reaching the back rank opens the promotion modal.
- **Camera**: Left-click and drag to orbit around the board; scroll to zoom in or out (clamped to keep the chamber framed).
- **Voice Move**: Click **Voice Move** in the top bar (in supported browsers such as Chrome/Edge) and speak a move like `"Knight to H3"`, `"Pawn to E4"`, or `"Castle kingside"`.
- **Audio & HUD Controls**: Use the top-bar sound controls to mute/unmute, adjust **Master** volume, or open the **Audio Mix** popover (`SlidersHorizontal` icon) for independent **Effects** and **Ambience** levels. Toggle **Hide Captures / Show Captures**, **Menu**, or **New Game** at any time.

---

## Project Structure

```text
src/
├── game/
│   ├── chessTypes.ts       # Shared TypeScript interfaces, board coordinate helpers, animation & status types
│   ├── useChessGame.ts     # Core chess.js state hook, move animation builder, AI turn trigger, check-drone & voice integration
│   ├── chessAI.ts          # Stockfish WASM Web Worker client (Easy/Medium/Hard) + alpha-beta minimax fallback
│   └── voiceCommands.ts    # Spoken-move parser matching speech transcripts and homophones against legal chess.js moves
├── components/
│   ├── Scene3D.tsx         # R3F Canvas, OrbitControls, lighting, physics world, post-processing, and WebGL fallback
│   ├── ChessBoard3D.tsx    # 8x8 marble & obsidian tiles, iron trim, algebraic coordinates, selection/check highlights
│   ├── ChessPiece3D.tsx    # Sculpted stone geometries for Pawn, Rook, Knight, Bishop, Queen, and King (+ separate crown)
│   ├── AnimatedMoveLayer.tsx   # Sliding, Knight L-hop, castling, promotion sink/rise, and capture strike choreography
│   ├── CaptureDebrisSystem.tsx # Static board/trench colliders and fading cannon-es physics stone shards on capture
│   ├── CheckmateSequence3D.tsx # Camera push-in, kneeling king, and bouncing fallen crown sequence
│   ├── StoneChamber3D.tsx  # Subterranean gothic hall, pillars, arches, rubble trench, and unlocking exit doors
│   ├── WallBrazier3D.tsx   # Wall-mounted and standing fire braziers with flickering lights and instanced flames
│   ├── DustBurstSystem.tsx # Pooled stone dust particle bursts on slides, hops, landings, and impacts
│   ├── ImpactFlashSystem.tsx   # Brief capture-impact point-light flash
│   ├── CameraShakeRig.tsx  # Decaying procedural camera shake on heavy landings and captures
│   └── GameHUD.tsx         # Start menu, turn/check banner, captured-pieces panel, audio mixer, promotion & game-over modals
└── utils/
    ├── proceduralTextures.ts   # Canvas-generated marble, obsidian, chamber stone, and oak wood color/bump/roughness maps
    ├── soundEffects.ts         # Single-AudioContext Web Audio synthesizer for SFX, ambient wind/fire bed, and check drone
    └── webglDetect.ts          # Software WebGL / SwiftShader detector for adaptive rendering quality
```

---

## Licensing & Disclaimer

- **Stockfish License Notice**: This application bundles `stockfish.js` (`stockfish`), which is distributed under the **GNU General Public License (GPL)**. If you redistribute or publish builds containing Stockfish, ensure compliance with the GPL license terms.
- **Originality Disclaimer**: *Stonebound Gambit* is an original game project and is **not affiliated with, endorsed by, or connected to any film, television, or book franchise**.
