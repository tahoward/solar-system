import * as THREE from 'three';

const MAX_SUNSPOTS = 8;
const TRANSITION_DURATION = 3.0;
const FLARE_DELAY = 4.0;
const FLARE_END_BUFFER = 6.0;
const SPOT_LIFETIME_MIN = 40.0;
const SPOT_LIFETIME_MAX = 80.0;

class SunspotManager {
    constructor(options = {}) {
        this.maxSpots = options.maxSpots || MAX_SUNSPOTS;
        this.spotRadius = options.spotRadius || 0.05;

        this.spots = [];
        this.positions = new Array(this.maxSpots).fill(null).map(() => new THREE.Vector3());
        this.opacities = new Float32Array(this.maxSpots);
        this.radii = new Float32Array(this.maxSpots);
        this.flareActive = new Float32Array(this.maxSpots);

        for (let i = 0; i < this.maxSpots; i++) {
            this.spots.push(this._createSpot());
        }

        this._updateArrays();
    }

    _createSpot() {
        let pos;
        // 60% chance to spawn near an existing active spot
        if (this.spots && this.spots.length > 0 && Math.random() < 0.6) {
            const activeSpots = this.spots.filter(s => s.opacity > 0.5);
            if (activeSpots.length > 0) {
                const parent = activeSpots[Math.floor(Math.random() * activeSpots.length)];
                // Offset by 0.05–0.15 from the parent spot
                const offset = new THREE.Vector3(
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1
                ).normalize().multiplyScalar(0.05 + Math.random() * 0.1);
                pos = parent.position.clone().add(offset).normalize();
            } else {
                pos = new THREE.Vector3(
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1
                ).normalize();
            }
        } else {
            pos = new THREE.Vector3(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
            ).normalize();
        }

        return {
            position: pos,
            radius: 0.0075 + Math.random() * 0.0075,
            lifetime: SPOT_LIFETIME_MIN + Math.random() * (SPOT_LIFETIME_MAX - SPOT_LIFETIME_MIN),
            age: 0,
            opacity: 0
        };
    }

    _updateArrays() {
        for (let i = 0; i < this.maxSpots; i++) {
            const spot = this.spots[i];
            this.positions[i].copy(spot.position);
            this.opacities[i] = spot.opacity;
            this.radii[i] = spot.radius;
            const flareStart = TRANSITION_DURATION + FLARE_DELAY;
            const flareEnd = spot.lifetime - TRANSITION_DURATION - FLARE_END_BUFFER;
            this.flareActive[i] = (spot.age >= flareStart && spot.age <= flareEnd) ? 1.0 : 0.0;
        }
    }

    update(deltaTime) {
        for (let i = 0; i < this.spots.length; i++) {
            const spot = this.spots[i];
            spot.age += deltaTime;

            if (spot.age < TRANSITION_DURATION) {
                spot.opacity = spot.age / TRANSITION_DURATION;
            } else if (spot.age > spot.lifetime - TRANSITION_DURATION) {
                spot.opacity = Math.max(0, (spot.lifetime - spot.age) / TRANSITION_DURATION);
            } else {
                spot.opacity = 1.0;
            }

            if (spot.age >= spot.lifetime) {
                this.spots[i] = this._createSpot();
            }
        }

        this._updateArrays();
    }

    getPositionsArray() {
        const arr = new Float32Array(this.maxSpots * 3);
        for (let i = 0; i < this.maxSpots; i++) {
            arr[i * 3] = this.positions[i].x;
            arr[i * 3 + 1] = this.positions[i].y;
            arr[i * 3 + 2] = this.positions[i].z;
        }
        return arr;
    }

    getOpacitiesArray() {
        return new Float32Array(this.opacities);
    }

    getSpotRadius() {
        return this.spotRadius;
    }

    getActiveCount() {
        return this.maxSpots;
    }
}

export default SunspotManager;
