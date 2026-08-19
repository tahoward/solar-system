import { CELESTIAL_DATA } from '../constants.js';
import Body from '../model/Body.js';

export class SolarSystemFactory {
    static createSolarSystem() {
        if (!CELESTIAL_DATA || !Array.isArray(CELESTIAL_DATA) || CELESTIAL_DATA.length === 0) {
            throw new Error('CELESTIAL_DATA must be a non-empty array');
        }

        const rootData = CELESTIAL_DATA[0];
        if (rootData.parent !== null) {
            throw new Error('First CELESTIAL_DATA entry must have parent: null (root body)');
        }

        const rootBody = new Body(rootData, null);

        return {
            body: rootBody,
            orbit: rootBody.orbit,
            children: rootBody.children
        };
    }

}

export default SolarSystemFactory;
