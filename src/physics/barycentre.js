const _weightedPosition = { x: 0, y: 0, z: 0 };
const _weightedVelocity = { x: 0, y: 0, z: 0 };

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

export function satelliteMass(body) {
    const children = body?.children;
    if (!children) return 0;

    let total = 0;
    for (let i = 0; i < children.length; i++) {
        total += systemMass(children[i].body);
    }

    return total;
}

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
