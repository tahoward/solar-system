/**
 * Centre-of-mass arithmetic over a body and everything that orbits it.
 *
 * A body's catalogued orbit belongs to the centre of mass of it and its satellites rather than to
 * the body itself, and the point every body in a system really moves about is the centre of mass
 * of the whole system. Both are the same weighted sum over a subtree of the hierarchy, so it lives
 * here rather than being written out again wherever it is needed.
 */

// Scratch values reused by the weighted sums, so that walking the hierarchy allocates nothing
const _weightedPosition = { x: 0, y: 0, z: 0 };
const _weightedVelocity = { x: 0, y: 0, z: 0 };

/**
 * The mass of a body together with everything that orbits it, directly or through others - what
 * the rest of the system feels from that body's direction.
 *
 * @param {Object|null} body - Body at the top of the subtree
 * @returns {number} Total mass in solar masses
 */
export function systemMass(body) {
    if (!body) return 0;

    let total = body.mass > 0 ? body.mass : 0;

    const children = body.children;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            total += systemMass(children[i].body);
        }
    }

    return total;
}

/**
 * The mass of everything orbiting a body, leaving the body itself out. What share of it any one
 * satellite accounts for decides whether that satellite alone describes where the system's centre
 * of mass is - see Orbit#updateCompanionLine.
 *
 * @param {Object|null} body - Body whose satellites are wanted
 * @returns {number} Total mass of the satellites in solar masses
 */
export function satelliteMass(body) {
    const children = body?.children;
    if (!children) return 0;

    let total = 0;
    for (let i = 0; i < children.length; i++) {
        total += systemMass(children[i].body);
    }

    return total;
}

/**
 * Add one subtree's contribution to a running mass-weighted sum of positions and velocities
 * @param {Object|null} body - Body at the top of the subtree
 * @returns {number} Mass added
 * @private
 */
function accumulate(body) {
    if (!body) return 0;

    let total = 0;

    if (body.mass > 0 && body.group) {
        const mass = body.mass;
        const position = body.group.position;
        const velocity = body.velocity;

        _weightedPosition.x += mass * position.x;
        _weightedPosition.y += mass * position.y;
        _weightedPosition.z += mass * position.z;

        if (velocity) {
            _weightedVelocity.x += mass * velocity.x;
            _weightedVelocity.y += mass * velocity.y;
            _weightedVelocity.z += mass * velocity.z;
        }

        total = mass;
    }

    const children = body.children;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            total += accumulate(children[i].body);
        }
    }

    return total;
}

/**
 * Where the centre of mass of a body and its satellites is, and how fast it is going: the point
 * that moves as if the whole subtree were one body sitting at it, which is what makes a system of
 * moons stand in for a single mass when its orbit about something further out is worked out.
 *
 * A massless subtree has no such point, so the body's own position and velocity are handed back
 * and the returned mass of zero tells the caller there was nothing to weight.
 *
 * @param {Object} body - Body at the top of the subtree
 * @param {THREE.Vector3} position - Receives the centre of mass, in world space
 * @param {THREE.Vector3} [velocity] - Receives its velocity
 * @returns {number} Total mass of the subtree in solar masses
 */
export function systemState(body, position, velocity) {
    _weightedPosition.x = _weightedPosition.y = _weightedPosition.z = 0;
    _weightedVelocity.x = _weightedVelocity.y = _weightedVelocity.z = 0;

    const mass = accumulate(body);

    if (mass > 0) {
        position.set(_weightedPosition.x, _weightedPosition.y, _weightedPosition.z).divideScalar(mass);
        if (velocity) {
            velocity.set(_weightedVelocity.x, _weightedVelocity.y, _weightedVelocity.z).divideScalar(mass);
        }
    } else {
        position.copy(body?.group?.position || position.set(0, 0, 0));
        if (velocity) velocity.copy(body?.velocity || velocity.set(0, 0, 0));
    }

    return mass;
}
