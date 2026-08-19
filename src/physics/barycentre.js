const _weightedPosition = { x: 0, y: 0, z: 0 };
const _weightedVelocity = { x: 0, y: 0, z: 0 };

/**
 * Totals the mass of a body and everything orbiting it.
 *
 * @param {Body|null} body - Subtree root; a missing body contributes nothing.
 * @returns {number} Combined mass of the subtree, ignoring negative masses.
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
 * Totals the mass orbiting a body, excluding the body itself.
 *
 * @param {Body|null} body - Body whose satellites are summed.
 * @returns {number} Combined mass of all descendants, or 0 if it has none.
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
 * Sums mass-weighted positions and velocities over a subtree.
 *
 * Results land in the module-level `_weightedPosition` and `_weightedVelocity`
 * scratch objects, which the caller must zero first. Writing to shared scratch
 * rather than returning a vector keeps this allocation-free on the per-frame
 * path, at the cost of not being re-entrant.
 *
 * Bodies without a mass or a scene group are skipped, as are missing velocities.
 *
 * @param {Body|null} body - Subtree root.
 * @returns {number} Total mass actually accumulated.
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
 * Computes the barycentre of a body and its satellites.
 *
 * This is the point the system actually orbits about, which is why a planet with
 * heavy moons visibly wobbles rather than sitting still. If the subtree has no
 * mass the body's own position and velocity are returned instead, so the caller
 * always gets a usable frame.
 *
 * @param {Body|null} body - Subtree root.
 * @param {THREE.Vector3} position - Receives the barycentre position; mutated.
 * @param {THREE.Vector3} [velocity] - Receives the barycentre velocity; mutated
 *   when supplied.
 * @returns {number} Total mass of the subtree, or 0 if it had none.
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

/**
 * Removes a system's net momentum by shifting every member's velocity.
 *
 * Rounding in the initial conditions leaves the system with a small overall
 * velocity, which over long runs carries it away from the origin. Subtracting the
 * barycentre velocity from every member cancels that drift while leaving the
 * relative motion — and therefore the orbits — untouched.
 *
 * @param {Body|null} body - Subtree root.
 * @returns {number} Speed that was removed, or 0 if the system was massless or
 *   already at rest.
 */
export function cancelSystemDrift(body) {
    _weightedPosition.x = _weightedPosition.y = _weightedPosition.z = 0;
    _weightedVelocity.x = _weightedVelocity.y = _weightedVelocity.z = 0;

    const mass = accumulate(body);
    if (!(mass > 0)) return 0;

    const x = _weightedVelocity.x / mass;
    const y = _weightedVelocity.y / mass;
    const z = _weightedVelocity.z / mass;

    const speed = Math.sqrt(x * x + y * y + z * z);
    if (speed === 0) return 0;

    subtractVelocity(body, x, y, z);
    return speed;
}

/**
 * Subtracts a velocity offset from a body and all its descendants.
 *
 * @param {Body|null} body - Subtree root.
 * @param {number} x - Velocity x component to remove.
 * @param {number} y - Velocity y component to remove.
 * @param {number} z - Velocity z component to remove.
 * @returns {void}
 */
function subtractVelocity(body, x, y, z) {
    if (!body) return;

    if (body.velocity) {
        body.velocity.x -= x;
        body.velocity.y -= y;
        body.velocity.z -= z;
    }

    const children = body.children;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            subtractVelocity(children[i].body, x, y, z);
        }
    }
}
