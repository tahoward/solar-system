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
- **Space**: Focus on Sun
- **[ / ]**: Navigate between bodies
- **P**: Toggle physics mode
- **+ / -**: Adjust simulation speed
- **T**: Toggle orbit trails
- **O**: Toggle orbit lines
- **M**: Toggle markers
- **B**: Toggle bloom effect

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