import { CELESTIAL_DATA } from '../constants.js';
import Body from '../model/Body.js';

/**
 * Factory class responsible for orchestrating the creation of solar systems
 */
export class SolarSystemFactory {
    /**
     * Create the complete solar system hierarchically from CELESTIAL_DATA
     * @returns {Object} Object containing all bodies and orbits organized hierarchically
     */
    static createSolarSystem() {

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

        // Create the root body - it will recursively create all its children
        const rootBody = new Body(rootData, null);

        // Return the hierarchy structure that matches the expected format
        return {
            body: rootBody,
            orbit: rootBody.orbit,
            children: rootBody.children
        };
    }

}

export default SolarSystemFactory;
