# 3D Solar System

An interactive 3D solar system simulation built with Three.js, featuring realistic physics and beautiful visual effects.

**[Live Demo](https://tahoward.github.io/solar-system/)**

## Features

- Real orbital mechanics with two physics modes (N-Body and Kepler)
- Custom sun shaders with corona, flares, and glow effects
- All planets from Mercury to Pluto with major moons
- Interactive camera controls and smooth animations
- Mobile-friendly interface

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Controls

### Keyboard

Navigation
- **← / →**: Previous / next body
- **Space**: Return to the Sun
- **S**: Smoothly re-centre on the current body
- **Backspace**: Reset the camera to its starting position

Simulation
- **Q**: Speed up
- **A**: Slow down
- **W**: Reset to normal speed
- **P**: Toggle physics mode (Kepler / N-Body)

Display
- **T**: Toggle orbit trails
- **L**: Toggle orbit lines
- **M**: Toggle markers
- **B**: Toggle bloom effect
- **+ / -**: Increase / decrease marker size
- **F3**: Toggle all overlays

### Mouse
- **Left drag**: Rotate camera
- **Right drag**: Pan camera
- **Scroll**: Zoom

## Build

```bash
npm run build
```

## Tech Stack

- Three.js for 3D rendering
- Custom GLSL shaders
- Vite for development and building

## Credits

- Shader implementations inspired by [Sangil Lee's Three.js tutorials](https://sangillee.com/threejs/)