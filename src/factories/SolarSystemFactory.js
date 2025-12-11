import * as THREE from 'three';
import Orbit from '../model/Orbit.js';
import SceneManager from '../managers/SceneManager.js';
import { CELESTIAL_DATA, ORBIT } from '../constants.js';
import BodyFactory from './BodyFactory.js';
import { log } from '../utils/Logger.js';

/**
 * Factory class responsible for orchestrating the creation of solar systems
 */
export class SolarSystemFactory {
    /**
     * Create the complete solar system hierarchically from CELESTIAL_DATA
     * @param {number} sceneScale - Scene scale factor for consistent scaling
     * @returns {Object} Object containing all bodies and orbits organized hierarchically
     */
    static createSolarSystem(sceneScale) {

        // CELESTIAL_DATA is now an array structure - support multiple root bodies for binary systems
        if (!CELESTIAL_DATA || !Array.isArray(CELESTIAL_DATA) || CELESTIAL_DATA.length === 0) {
            throw new Error('CELESTIAL_DATA must be a non-empty array');
        }

        // For now, use the first root body (single star system)
        // TODO: Support multiple root bodies for binary star systems
        const rootData = CELESTIAL_DATA[0];
        if (rootData.parent !== null) {
            throw new Error('First CELESTIAL_DATA entry must have parent: null (root body)');
        }

        // Create all bodies hierarchically starting from the root
        const { body: rootBody, orbit: rootOrbit, children } = this.createBodyHierarchy(rootData, null, sceneScale);

        // Flatten children to get planets and orbits arrays for backward compatibility
        const planets = [];
        const orbits = [];

        // Include the root body's virtual orbit in the orbits array
        if (rootOrbit) {
            orbits.push(rootOrbit);
        }

        function flattenHierarchy(bodyData) {
            if (bodyData.children) {
                bodyData.children.forEach(child => {
                    planets.push(child.body);
                    if (child.orbit) orbits.push(child.orbit);
                    flattenHierarchy(child);
                });
            }
        }

        flattenHierarchy({ children });

        return {
            planets,
            orbits,
            hierarchy: { body: rootBody, children } // Include full hierarchy
        };
    }

    /**
     * Recursively create a body and all its children from CELESTIAL_DATA
     * @param {Object} bodyData - The celestial body data from CELESTIAL_DATA
     * @param {Body|null} parentBody - The parent body (null for root)
     * @param {number} sceneScale - Scene scale factor for consistent scaling
     * @returns {Object} Object containing the body and its children hierarchy
     */
    static createBodyHierarchy(bodyData, parentBody = null, sceneScale) {
        // Create the body using BodyFactory
        const body = BodyFactory.createBodyFromData(bodyData, parentBody);


        // Create orbit - real orbit for bodies with parents, virtual orbit for root body (Sun)
        let orbit = null;
        if (parentBody && bodyData.a) {
            // Regular orbit for bodies orbiting a parent
            if (body && body.group) {
                orbit = this.createOrbitFromData(bodyData, body, parentBody, sceneScale);

                // Register orbit with SceneManager
                SceneManager.registerOrbit(orbit);
            } else {
                log.warn('SolarSystemFactory', `✗ Skipped orbit for ${bodyData.name} - invalid body:`, { hasBody: !!body, hasGroup: !!body?.group });
            }
        } else if (!parentBody && body) {
            // Create virtual stationary orbit for root body (Sun)
            orbit = this.createVirtualOrbit(body);

            // Register virtual orbit with SceneManager
            SceneManager.registerOrbit(orbit);
        }

        // Recursively create children
        const children = [];
        if (bodyData.children && bodyData.children.length > 0) {
            bodyData.children.forEach(childData => {
                // childData is now the actual object, not a name reference
                const childHierarchy = this.createBodyHierarchy(childData, body, sceneScale);
                children.push(childHierarchy);
            });
        }

        return {
            body,
            orbit,
            children,
            data: bodyData
        };
    }

    /**
     * Create orbit from celestial data
     * @param {Object} bodyData - The celestial body data with orbital elements
     * @param {Body} body - The orbiting body
     * @param {Body} parentBody - The body being orbited
     * @param {number} sceneScale - Scene scale factor for consistent scaling
     * @returns {Orbit} The created orbit
     */
    static createOrbitFromData(bodyData, body, parentBody, sceneScale) {
        return new Orbit(
            body,
            bodyData.a,        // semiMajorAxis
            bodyData.e,        // eccentricity
            bodyData.i,        // inclination
            parentBody,        // parentBody for relative positioning
            bodyData.omega || 0,    // longitudeOfAscendingNode
            bodyData.w || 0,        // argumentOfPeriapsis
            bodyData.M0 || 0,       // meanAnomalyAtEpoch
            sceneScale             // Scene scale factor
        );
    }

    /**
     * Create a virtual stationary orbit for the root body (Sun)
     * This allows the Sun to be treated uniformly with other bodies in the orbit system
     * @param {Body} body - The body to create a virtual orbit for
     * @returns {Object} Virtual orbit object that keeps the body at (0,0,0)
     */
    static createVirtualOrbit(body) {
        return {
            body: body,
            parentBody: null,
            semiMajorAxis: 0,
            eccentricity: 0,
            orbitalPeriod: 0,
            // Virtual orbit always returns (0,0,0) position
            calculatePosition: () => new THREE.Vector3(0, 0, 0),
            // Visibility methods for compatibility with VisibilityManager
            show: () => {}, // No-op - Sun has no orbit line to show
            hide: () => {}, // No-op - Sun has no orbit line to hide
            getVisibility: () => true, // Sun is always "visible"
            // Orbit line properties for compatibility
            orbitLine: null,
            isVisible: true
        };
    }
}

export default SolarSystemFactory;
