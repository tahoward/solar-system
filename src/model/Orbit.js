import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import { ORBIT, MATH } from '../constants.js';
import { calculateOrbitalMotion, calculateKeplerianPosition, getAUScale } from '../physics/kepler.js';

const PI_OVER_180 = MATH.PI_OVER_180;


class Orbit {
    /**
     * Represents an orbital path for a celestial body.
     */
    constructor(body, semiMajorAxis, eccentricity, inclination = 0, parentBody = null, longitudeOfAscendingNode = 0, argumentOfPeriapsis = 0, meanAnomalyAtEpoch = 0, sceneScale) {
        // Validate configuration using centralized validator
        if (!body || typeof body !== 'object') {
            throw new Error('Orbit constructor: body must be a valid Body object');
        }
        if (typeof sceneScale !== 'number' || sceneScale <= 0) {
            throw new Error('Orbit constructor: sceneScale must be a positive number');
        }
        ConfigValidator.validateOrbitConfig({ semiMajorAxis, eccentricity, inclination });

        const orbitMaterial = new LineMaterial({
            color: body.markerColor || body.material.color, // Use marker color if available, fallback to material color
            linewidth: 2, // Line width in pixels
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true, // Enable transparency for proper depth sorting
            opacity: 0.8, // Slightly transparent so markers show through
            depthWrite: false, // Don't write to depth buffer to avoid conflicts with markers
            depthTest: true // Still test depth for proper ordering
        });
        this.body = body;
        this.parentBody = parentBody; // Store parent body for relative positioning
        this.semiMajorAxis = semiMajorAxis; // Keep in AU for calculations
        // Store the scene scale for consistent scaling with body positions
        this.sceneScale = sceneScale; // Use explicitly passed scale
        this.semiMajorAxisVisual = semiMajorAxis * getAUScale(this.sceneScale); // Scaled for visual display
        this.eccentricity = eccentricity;
        this.inclinationRadians = inclination * PI_OVER_180;

        // Additional orbital elements for accurate positioning
        this.longitudeOfAscendingNodeRadians = longitudeOfAscendingNode * PI_OVER_180;
        this.argumentOfPeriapsisRadians = argumentOfPeriapsis * PI_OVER_180;
        this.meanAnomalyAtEpochRadians = meanAnomalyAtEpoch * PI_OVER_180;

        // Orbital mechanics properties using astronomical units
        const orbitalMotion = calculateOrbitalMotion(semiMajorAxis, parentBody);
        this.n = orbitalMotion.meanMotion; // Mean motion in radians/year
        this.orbitalPeriod = orbitalMotion.orbitalPeriod; // Period in years


        // Moon inclinations are relative to parent's equatorial plane
        // The orbit line will inherit the parent's axial tilt via the tiltContainer hierarchy

        // Level-of-detail properties
        this.currentSegments = ORBIT.CIRCUMFERENCE_MULTIPLIER; // Current number of segments
        this.lastLODUpdate = 0; // Frame counter for LOD updates
        this.orbitCenter = new THREE.Vector3(); // Cache orbit center for distance calculations

        // Create visual orbit path and store reference for disposal
        this.orbitLine = new Line2(this.#createOrbitPath(), orbitMaterial);

        // Set render order to ensure orbit lines render behind markers
        this.orbitLine.renderOrder = -100; // Large negative value ensures orbit lines render before markers
        this.orbitLine.material.userData = { renderBehindMarkers: true }; // Mark for special handling

        // Calculate and cache orbit center position for LOD calculations
        this.#updateOrbitCenter();

        // Add orbit line based on parent's ecliptic attribute
        if (this.parentBody && this.parentBody.tiltContainer && !this.parentBody.ecliptic) {
            // Parent wants children in equatorial plane - add to parent's tiltContainer
            this.parentBody.tiltContainer.add(this.orbitLine);
        } else if (this.parentBody && this.parentBody.group) {
            // Parent wants children in ecliptic plane - add to parent's main group (untilted)
            this.parentBody.group.add(this.orbitLine);
        } else {
            // No parent - add to scene (root body like Sun)
            SceneManager.scene.add(this.orbitLine);
        }

        // Register material for resolution updates
        SceneManager.registerLineMaterial(orbitMaterial);

        // Initial visibility state
        this.isVisible = true;
    }

    /**
     * Creates the geometric representation of the orbital path.
     * @param {number} segments - Number of segments to use (optional, defaults to current segments)
     * @returns {LineGeometry} The geometry representing the orbit path.
     */
    #createOrbitPath(segments) {
        const points = [];
        const steps = segments || this.currentSegments;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps * this.orbitalPeriod;

            // Calculate position using Keplerian elements directly
            const orbitalElements = {
                semiMajorAxis: this.semiMajorAxis,
                eccentricity: this.eccentricity,
                inclinationRadians: this.inclinationRadians,
                longitudeOfAscendingNodeRadians: this.longitudeOfAscendingNodeRadians,
                argumentOfPeriapsisRadians: this.argumentOfPeriapsisRadians,
                meanAnomalyAtEpochRadians: this.meanAnomalyAtEpochRadians,
                meanMotion: this.n
            };

            // Note: calculateKeplerianPosition uses the current auScale from kepler.js
            // which should match this.sceneScale
            const pos = calculateKeplerianPosition(t, orbitalElements);

            // Orbit line coordinates are always relative to parent
            // The container (tiltContainer vs scene) determines the coordinate space

            points.push(pos.x, pos.y, pos.z);
        }

        // Close the loop by adding the first point at the end
        points.push(points[0], points[1], points[2]);

        const geometry = new LineGeometry();
        geometry.setPositions(points);
        return geometry;
    }

     #circumference() {
         const a = this.semiMajorAxisVisual; // Use visual scaling for orbit path
         const e = this.eccentricity;
         const b = a * Math.sqrt(1 - e ** 2);
         
         return Math.PI * (MATH.ELLIPSE_FACTOR_A * (a + b) - Math.sqrt((MATH.ELLIPSE_FACTOR_A * a + b) * (a + MATH.ELLIPSE_FACTOR_B * b)));
     }





    /**
     * Show the orbit line
     */
    show() {
        if (this.orbitLine && !this.isVisible) {
            this.orbitLine.visible = true;
            this.isVisible = true;
        }
    }

    /**
     * Hide the orbit line
     */
    hide() {
        if (this.orbitLine && this.isVisible) {
            this.orbitLine.visible = false;
            this.isVisible = false;
        }
    }

    /**
     * Get visibility state of the orbit line
     * @returns {boolean} True if visible, false if hidden
     */
    getVisibility() {
        return this.isVisible && this.orbitLine?.visible;
    }

    /**
     * Update orbit center position for LOD calculations
     * @private
     */
    #updateOrbitCenter() {
        if (this.parentBody) {
            // Orbit center is at parent body position
            this.orbitCenter.copy(this.parentBody.group.position);
        } else {
            // Root orbit (around origin)
            this.orbitCenter.set(0, 0, 0);
        }
    }

    /**
     * Calculate appropriate number of segments based on camera distance
     * @param {THREE.Vector3} cameraPosition - Current camera position
     * @returns {number} Number of segments to use for orbit line
     * @private
     */
    #calculateLODSegments(cameraPosition) {
        // Update orbit center position
        this.#updateOrbitCenter();

        // Calculate distance from camera to orbit center
        const distance = cameraPosition.distanceTo(this.orbitCenter);

        // Calculate segments based on distance with smooth interpolation
        let segmentRatio;
        if (distance <= ORBIT.LOD.CLOSE_DISTANCE) {
            segmentRatio = 1.0; // Maximum detail
        } else if (distance >= ORBIT.LOD.FAR_DISTANCE) {
            segmentRatio = 0.0; // Minimum detail
        } else {
            // Smooth interpolation between close and far
            segmentRatio = 1.0 - (distance - ORBIT.LOD.CLOSE_DISTANCE) /
                                (ORBIT.LOD.FAR_DISTANCE - ORBIT.LOD.CLOSE_DISTANCE);
        }

        // Calculate max segments proportional to orbit radius
        // Larger orbits need more segments for smooth curves
        const orbitRadius = this.semiMajorAxisVisual;
        const radiusScale = Math.max(0.1, Math.min(10, orbitRadius / 100)); // Scale factor based on orbit size
        const maxSegmentsForOrbit = Math.round(ORBIT.LOD.MAX_SEGMENTS * radiusScale);

        // Calculate final segment count
        const segments = Math.round(
            ORBIT.LOD.MIN_SEGMENTS +
            segmentRatio * (maxSegmentsForOrbit - ORBIT.LOD.MIN_SEGMENTS)
        );

        return Math.max(ORBIT.LOD.MIN_SEGMENTS, Math.min(maxSegmentsForOrbit, segments));
    }

    /**
     * Update orbit line level-of-detail based on camera distance
     * @param {THREE.Vector3} cameraPosition - Current camera position
     */
    updateLOD(cameraPosition) {
        // Only update occasionally for performance
        this.lastLODUpdate++;
        const shouldUpdate = this.lastLODUpdate % Math.round(1 / ORBIT.LOD.UPDATE_FREQUENCY) === 0;

        if (!shouldUpdate) return;

        const newSegments = this.#calculateLODSegments(cameraPosition);

        // Only rebuild geometry if segment count changed significantly
        const segmentDifference = Math.abs(newSegments - this.currentSegments);
        const thresholdChange = Math.max(8, this.currentSegments * 0.1); // At least 8 segments or 10% change

        if (segmentDifference >= thresholdChange) {
            // Store new segment count
            this.currentSegments = newSegments;

            // Create new geometry with updated segment count
            const newGeometry = this.#createOrbitPath(newSegments);

            // Replace geometry
            const oldGeometry = this.orbitLine.geometry;
            this.orbitLine.geometry = newGeometry;

            // Dispose old geometry to free memory
            if (oldGeometry) {
                oldGeometry.dispose();
            }
        }
    }

    /**
     * Clean up orbit resources
     */
    dispose() {
        // Remove orbit line from its parent (either parent body's group or scene)
        if (this.orbitLine && this.orbitLine.parent) {
            this.orbitLine.parent.remove(this.orbitLine);
        }

        // Dispose orbit line geometry and material
        if (this.orbitLine) {
            if (this.orbitLine.geometry) {
                this.orbitLine.geometry.dispose();
            }
            if (this.orbitLine.material) {
                // Unregister material from SceneManager
                SceneManager.unregisterLineMaterial(this.orbitLine.material);
                this.orbitLine.material.dispose();
            }
        }

        // Clear references
        this.orbitLine = null;
        this.body = null;
    }
}

export default Orbit;
