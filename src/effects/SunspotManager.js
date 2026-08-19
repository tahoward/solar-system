import * as THREE from 'three';

/**
 * How many spots exist at once, matching the sunspot array size in
 * {@link SunShaderMaterial}'s fragment shader, whose loop bound must be a compile-time
 * constant.
 *
 * @type {number}
 */
const MAX_SUNSPOTS = 8;

/**
 * Seconds a spot spends fading in, and again fading out.
 *
 * @type {number}
 */
const TRANSITION_DURATION = 3.0;

/**
 * Seconds after a spot has finished appearing before it starts throwing flares, so the
 * flare follows the spot rather than arriving with it.
 *
 * @type {number}
 */
const FLARE_DELAY = 4.0;

/**
 * Seconds before a spot begins fading that its flares stop, so the flares are gone before
 * the spot they came from is.
 *
 * @type {number}
 */
const FLARE_END_BUFFER = 10.0;

/**
 * Shortest a spot lives, in seconds.
 *
 * @type {number}
 */
const SPOT_LIFETIME_MIN = 40.0;

/**
 * Longest a spot lives, in seconds.
 *
 * @type {number}
 */
const SPOT_LIFETIME_MAX = 160.0;

/**
 * Keeps a star's sunspots appearing, drifting in prominence and dying.
 *
 * A fixed pool of spots, each with its own lifetime, recycled in place when it expires:
 * the shader needs a fixed-size array, and reusing slots means the count never has to
 * change. What the viewer sees is spots fading in and out at different times, which is
 * what makes the surface look alive rather than statically blemished.
 *
 * New spots are usually placed near an existing one, because real sunspots come in
 * groups rather than scattered evenly over the photosphere.
 *
 * The output is three parallel arrays, which {@link SunShaderMaterial#updateSunspots} takes
 * by reference. They are mutated in place here, so the material never needs re-uploading
 * beyond its usual per-frame uniform update.
 */
class SunspotManager {
    /**
     * Fills the pool with spots.
     *
     * Every spot starts at age zero, so on the first frames the star has no visible spots
     * and they all fade in together; after that their staggered lifetimes pull them apart.
     *
     * @param {Object} [options={}] - Options.
     * @param {number} [options.maxSpots=8] - Pool size. Must match the shader's array
     *   length, so in practice this is left alone.
     */
    constructor(options = {}) {
        this.maxSpots = options.maxSpots || MAX_SUNSPOTS;
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

    /**
     * Makes one new spot.
     *
     * Most of the time it is placed close to an existing, fully faded-in spot, which is
     * what produces the clusters real sunspots form in. The rest of the time — and always
     * when nothing else is currently visible — it goes somewhere random on the sphere, so
     * a cluster that dies out does not take the whole population with it.
     *
     * Positions are unit vectors in the star's object space, which is what the shader
     * compares its surface normal against.
     *
     * @private
     * @returns {{position: THREE.Vector3, radius: number, lifetime: number, age: number,
     *   opacity: number}} The new spot.
     */
    _createSpot() {
        let pos;
        if (this.spots && this.spots.length > 0 && Math.random() < 0.6) {
            const activeSpots = this.spots.filter(s => s.opacity > 0.5);
            if (activeSpots.length > 0) {
                const parent = activeSpots[Math.floor(Math.random() * activeSpots.length)];
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

    /**
     * Copies the pool's state into the flat arrays the shader reads.
     *
     * Also works out each spot's flare activity, a 0-to-1 ramp that rises a few seconds
     * after the spot has settled and falls before it starts to die. Flares are tied to spots
     * because that is where they come from on a real star, and the buffers at either end
     * keep a flare from being seen without a spot beneath it.
     *
     * Values are written into the existing arrays rather than replacing them, so the
     * material's uniforms keep pointing at the same buffers.
     *
     * @private
     * @returns {void}
     */
    _updateArrays() {
        const maxFlareLifespan = 4.0;
        for (let i = 0; i < this.maxSpots; i++) {
            const spot = this.spots[i];
            this.positions[i].copy(spot.position);
            this.opacities[i] = spot.opacity;
            this.radii[i] = spot.radius;
            const flareStart = TRANSITION_DURATION + FLARE_DELAY;
            const flareEnd = spot.lifetime - TRANSITION_DURATION - FLARE_END_BUFFER;

            let active = 0.0;
            if (spot.age < flareStart) {
                active = 0.0;
            } else if (spot.age < flareStart + maxFlareLifespan) {
                active = (spot.age - flareStart) / maxFlareLifespan;
            } else if (spot.age <= flareEnd) {
                active = 1.0;
            } else if (spot.age < flareEnd + maxFlareLifespan) {
                active = 1.0 - (spot.age - flareEnd) / maxFlareLifespan;
            }
            this.flareActive[i] = Math.max(0, Math.min(1, active));
        }
    }

    /**
     * Ages every spot, replacing any that have expired.
     *
     * Opacity ramps up over the transition at the start of a spot's life and back down at
     * the end, holding at full in between — spots that snapped in and out would read as
     * flickering rather than as weather.
     *
     * An expired spot is replaced immediately, in the same slot. Its replacement starts at
     * zero opacity, so the slot fades out and back in rather than jumping to a new place on
     * the surface.
     *
     * @param {number} deltaTime - Time since the last frame, in scaled seconds.
     * @returns {void}
     */
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
}

export default SunspotManager;
