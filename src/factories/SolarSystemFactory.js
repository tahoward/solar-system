import { CELESTIAL_DATA } from '../constants.js';
import Body from '../model/Body.js';

/**
 * Turns the catalogue in `constants.js` into a live hierarchy of bodies.
 *
 * Only the root has to be constructed: {@link Body} builds its own children from the
 * catalogue, so creating the Sun recursively creates the whole system.
 *
 * Static only.
 */
export class SolarSystemFactory {
    /**
     * Builds the system from `CELESTIAL_DATA`.
     *
     * Both checks throw rather than warn, because there is nothing sensible to render
     * without a root body — failing here gives a clear message instead of a cascade of
     * null errors further in.
     *
     * @returns {{body: Body, orbit: Orbit, children: Object[]}} The root hierarchy node.
     * @throws {Error} If the catalogue is empty, or if its first entry is not a root
     *   body.
     */
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
