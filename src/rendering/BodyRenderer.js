import * as THREE from 'three';
import { GEOMETRY } from '../constants.js';
import SceneManager from '../managers/SceneManager.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import { log } from '../utils/Logger.js';

/**
 * Scratch vector for reading the drawing buffer size, reused to avoid a per-frame,
 * per-body allocation.
 *
 * @type {THREE.Vector2}
 */
const _bufferSize = new THREE.Vector2();

/**
 * How many segments a sphere needs to look round at a given size on screen.
 *
 * A polygon of `n` segments approximating a circle of radius `r` departs from it by at most
 * `r(1 - cos(π/n))`, which for large `n` is about `r·π²/(2n²)`. Setting that equal to the
 * error budget and solving for `n` gives this expression. The point is that the segment
 * count scales with the *square root* of the screen radius: a body four times larger on
 * screen needs only twice the segments, so even a planet filling the view is affordable.
 *
 * @param {number} screenRadius - The body's radius in pixels.
 * @returns {number} Segments needed, unrounded and unclamped.
 */
function segmentsForScreenRadius(screenRadius) {
    return Math.PI * Math.sqrt(screenRadius / (2 * GEOMETRY.SPHERE_DETAIL_MAX_ERROR_PIXELS));
}

/**
 * Picks the smallest tier that meets a segment requirement.
 *
 * Fixed tiers rather than an exact count, so geometries can be built once and reused as the
 * camera moves back and forth instead of being rebuilt on every frame.
 *
 * The hysteresis is what makes this usable. Without it, a body sitting near a tier boundary
 * would swap geometry every frame as the distance jitters, which is both a visible pop and
 * a steady allocation cost. The current tier is therefore held onto until the requirement
 * has fallen well below it, not merely below it.
 *
 * @param {number} needed - Segments required, from
 *   {@link segmentsForScreenRadius}.
 * @param {number} [current] - The tier currently in use, if any.
 * @returns {number} The chosen tier; the largest tier if none is sufficient.
 */
function selectDetailTier(needed, current) {
    const tiers = GEOMETRY.SPHERE_DETAIL_TIERS;

    if (current && needed <= current && needed > current * GEOMETRY.SPHERE_DETAIL_HYSTERESIS) {
        return current;
    }

    for (const tier of tiers) {
        if (tier >= needed) return tier;
    }

    return tiers[tiers.length - 1];
}

/**
 * Swaps a mesh onto the geometry for a given tier, building it if this is the first time.
 *
 * Geometries are cached on the mesh and kept, not discarded when the tier changes: a body
 * the camera is approaching and retreating from will want the same few tiers repeatedly, and
 * rebuilding a sphere is far more expensive than holding one. They are released together by
 * {@link BodyRenderer.disposeDetailGeometries}.
 *
 * Returns immediately if the mesh is already on this tier, which is the common case — most
 * bodies do not change tier on most frames.
 *
 * @param {THREE.Mesh} mesh - Mesh to retessellate; must have been registered with
 *   {@link BodyRenderer.registerDetailMesh}.
 * @param {number} segments - The tier to switch to.
 * @returns {void}
 */
function applyDetailTier(mesh, segments) {
    if (!mesh || mesh.userData.detailSegments === segments) return;

    let cache = mesh.userData.detailGeometries;
    if (!cache) {
        cache = mesh.userData.detailGeometries = new Map();
    }

    let geometry = cache.get(segments);
    if (!geometry) {
        geometry = new THREE.SphereGeometry(mesh.userData.detailRadius, segments, segments);
        cache.set(segments, geometry);
    }

    mesh.geometry = geometry;
    mesh.userData.detailSegments = segments;
}

/**
 * Builds the Three.js objects a body is made of, and keeps their tessellation appropriate.
 *
 * Two jobs. The first is construction: spheres, rings, cloud shells and atmosphere shells,
 * each needing particular geometry and material choices that {@link Body} should not have to
 * carry.
 *
 * The second is level of detail. The scene spans from a moon's surface to the outer planets,
 * so a fixed tessellation cannot work: enough segments for a planet filling the screen,
 * applied to the dozens of bodies that are a few pixels across, is wasted almost entirely.
 * Each body's segment count is therefore chosen from its size on screen, against a
 * sub-pixel error budget, so the tessellation is as coarse as it can be without the silhouette
 * showing facets.
 *
 * Static only.
 */
class BodyRenderer {
    /**
     * Builds a sphere at the starting tessellation.
     *
     * A middling tier rather than the coarsest, so a body looks right on the first frame,
     * before {@link BodyRenderer.updateDetail} has had a chance to run.
     *
     * @param {number} radius - Sphere radius in scene units.
     * @returns {THREE.SphereGeometry} The geometry.
     */
    static createGeometry(radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        return new THREE.SphereGeometry(radius, segments, segments);
    }

    /**
     * Marks a mesh as retessellatable, and seeds its geometry cache.
     *
     * The radius is recorded because rebuilding a sphere at another tier needs it, and the
     * geometry itself cannot be asked. The mesh's existing geometry is entered into the cache
     * as the starting tier, so it is reused rather than rebuilt if the camera returns to that
     * distance.
     *
     * @param {THREE.Mesh} mesh - Mesh to register.
     * @param {number} radius - The mesh's sphere radius in scene units.
     * @returns {void}
     */
    static registerDetailMesh(mesh, radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        mesh.userData.detailRadius = radius;
        mesh.userData.detailSegments = segments;
        mesh.userData.detailGeometries = new Map([[segments, mesh.geometry]]);
    }

    /**
     * Pairs a geometry with a material.
     *
     * @param {THREE.BufferGeometry} geometry - The geometry.
     * @param {THREE.Material} material - The material.
     * @returns {THREE.Mesh} The mesh.
     */
    static createMesh(geometry, material) {
        return new THREE.Mesh(geometry, material);
    }

    /**
     * Builds the container a body's parts hang off.
     *
     * The body is stored back onto the group, so code that has only found a Three.js object —
     * a raycast hit, a scene traversal — can get to the body it belongs to.
     *
     * @param {Body} bodyInstance - The body this group represents.
     * @returns {THREE.Group} The group, carrying `bodyInstance`.
     */
    static createGroup(bodyInstance) {
        const bodyContainer = new THREE.Group();
        bodyContainer.bodyInstance = bodyInstance;
        return bodyContainer;
    }

    /**
     * Builds a single-pixel point that stands in for a body too small to see.
     *
     * Beyond a certain distance a body's sphere covers less than a pixel and either vanishes
     * or flickers as it falls in and out of the sample grid. A point sprite with size
     * attenuation off holds a constant one pixel however far away it is, which is what a
     * distant body should look like anyway.
     *
     * Tone mapping and fog are off so the point keeps the body's actual colour rather than
     * being darkened towards the background.
     *
     * @param {THREE.Material} material - The body's material, to take a colour from.
     * @param {string} name - The body's name, used to name the point.
     * @returns {THREE.Points} The pinpoint object.
     */
    static createPinpointLight(material, name) {
        const pointGeometry = new THREE.BufferGeometry();
        const position = new Float32Array([0, 0, 0]);
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));

        const baseColor = material.color || new THREE.Color(0xffffff);
        const pointMaterial = new THREE.PointsMaterial({
            color: baseColor,
            size: 1.0,
            transparent: true,
            opacity: 1.0,
            sizeAttenuation: false,
            toneMapped: false,
            fog: false
        });

        const pinpointMesh = new THREE.Points(pointGeometry, pointMaterial);
        pinpointMesh.name = `${name}_pinpoint`;

        return pinpointMesh;
    }

    /**
     * Builds a ring system as two coplanar discs.
     *
     * Two meshes, back to back, rather than one double-sided disc: the ring shader needs to
     * know which side is being looked at to shade it, and a single mesh with `DoubleSide`
     * would not distinguish them.
     *
     * The texture is taken from the preloaded set if it is there. A miss is loaded directly
     * and logged as a warning, since it means the ring will pop in some frames after the body
     * — the preloader is meant to have everything ready before anything is shown.
     *
     * @param {Object} ringConfig - Ring configuration.
     * @param {number} ringConfig.innerRadius - Inner edge, as a multiple of the body's radius.
     * @param {number} ringConfig.outerRadius - Outer edge, as a multiple of the body's radius.
     * @param {number} ringConfig.opacity - Ring opacity.
     * @param {string} [ringConfig.texture] - Texture path.
     * @param {number} bodyRadius - The body's radius in scene units.
     * @param {Map<string, THREE.Texture>|null} preloadedTextures - The preloaded textures.
     * @param {string} bodyName - The body's name, for logging.
     * @returns {THREE.Group} A group holding both ring meshes.
     */
    static createRings(ringConfig, bodyRadius, preloadedTextures, bodyName) {
        const { innerRadius, outerRadius, opacity } = ringConfig;

        const ringGeometry = BodyRenderer.createRadialRingGeometry(
            bodyRadius * innerRadius,
            bodyRadius * outerRadius,
            64
        );

        let ringTexture = null;
        if (ringConfig.texture) {
            if (preloadedTextures && preloadedTextures.has(ringConfig.texture)) {
                ringTexture = preloadedTextures.get(ringConfig.texture);
                log.debug('BodyRenderer', `Using preloaded ring texture for ${bodyName}`);
            } else {
                log.warn('BodyRenderer', `Preloaded ring texture not found for ${ringConfig.texture}, loading directly...`);
                const textureLoader = new THREE.TextureLoader();
                ringTexture = textureLoader.load(ringConfig.texture);

                ringTexture.wrapS = THREE.ClampToEdgeWrapping;
                ringTexture.wrapT = THREE.RepeatWrapping;
                ringTexture.generateMipmaps = true;
                ringTexture.minFilter = THREE.LinearMipmapLinearFilter;
                ringTexture.magFilter = THREE.LinearFilter;
            }
        }

        const ringMaterial = new RingShaderMaterial({
            ringTexture: ringTexture,
            opacity: opacity,
            planetRadius: bodyRadius,
            hasPlanetShadow: true
        });

        const ringGroup = new THREE.Group();

        const topRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        topRingMesh.rotation.x = Math.PI / 2;
        topRingMesh.receiveShadow = true;
        ringGroup.add(topRingMesh);

        const bottomRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        bottomRingMesh.rotation.x = -Math.PI / 2;
        bottomRingMesh.receiveShadow = true;
        ringGroup.add(bottomRingMesh);

        return ringGroup;
    }

    /**
     * Builds an annulus whose UVs run radially.
     *
     * Three.js's own `RingGeometry` maps its texture across the ring's plane, which is wrong
     * for planetary rings: a ring texture is a one-dimensional strip of bands, and it has to
     * be stretched from the inner edge to the outer with the same profile all the way round.
     * So the UVs are built here with `u` running from the outer edge to the inner and `v`
     * running around the ring, which is what the strip needs.
     *
     * `u` is deliberately 1 at the inner edge and 0 at the outer, matching the convention
     * ring texture strips are stored in.
     *
     * One ring of vertices per segment, two vertices each, with flat normals along the
     * plane's axis — the ring is lit as a flat sheet, so per-vertex normals would add nothing.
     *
     * @param {number} innerRadius - Inner edge in scene units.
     * @param {number} outerRadius - Outer edge in scene units.
     * @param {number} [thetaSegments=64] - Segments around the ring.
     * @returns {THREE.BufferGeometry} The annulus.
     */
    static createRadialRingGeometry(innerRadius, outerRadius, thetaSegments = 64) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];
        const uvs = [];

        for (let i = 0; i <= thetaSegments; i++) {
            const theta = (i / thetaSegments) * Math.PI * 2;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const innerX = innerRadius * cosTheta;
            const innerY = innerRadius * sinTheta;
            vertices.push(innerX, innerY, 0);
            uvs.push(1, i / thetaSegments);

            const outerX = outerRadius * cosTheta;
            const outerY = outerRadius * sinTheta;
            vertices.push(outerX, outerY, 0);
            uvs.push(0, i / thetaSegments);
        }

        for (let i = 0; i < thetaSegments; i++) {
            const innerCurrent = i * 2;
            const outerCurrent = i * 2 + 1;
            const innerNext = (i + 1) * 2;
            const outerNext = (i + 1) * 2 + 1;

            indices.push(innerCurrent, outerCurrent, innerNext);
            indices.push(innerNext, outerCurrent, outerNext);
        }

        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const normals = [];
        for (let i = 0; i < vertices.length / 3; i++) {
            normals.push(0, 0, 1);
        }
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }

    /**
     * Builds a cloud layer on a shell just above the surface.
     *
     * The rotation speed is stored on the mesh rather than applied, so {@link Body} can turn
     * the clouds at a different rate from the surface beneath them — which is what makes a
     * planet's weather look like weather rather than paint.
     *
     * The material is also stored on `userData`, so per-frame uniform updates do not have to
     * reach through the mesh and guess at the material's type.
     *
     * @param {Object} cloudConfig - Cloud configuration.
     * @param {string} cloudConfig.texture - Texture path; colour with coverage in the alpha.
     * @param {number} cloudConfig.radiusScale - Shell radius as a multiple of the body's.
     * @param {number} [cloudConfig.opacity=0.8] - Overall coverage multiplier.
     * @param {number} [cloudConfig.rotationSpeed=1.0] - Rotation rate relative to the body's.
     * @param {number} [cloudConfig.alphaTest=0.1] - Coverage below which fragments are
     *   discarded.
     * @param {number} bodyRadius - The body's radius in scene units.
     * @param {string} bodyName - The body's name, for logging.
     * @returns {THREE.Mesh} The cloud shell.
     */
    static createClouds(cloudConfig, bodyRadius, bodyName) {
        const { texture, radiusScale, opacity, rotationSpeed, alphaTest } = cloudConfig;

        const cloudRadius = bodyRadius * radiusScale;
        const cloudGeometry = BodyRenderer.createGeometry(cloudRadius);

        const textureLoader = new THREE.TextureLoader();
        const cloudTexture = textureLoader.load(texture);

        cloudTexture.wrapS = THREE.RepeatWrapping;
        cloudTexture.wrapT = THREE.RepeatWrapping;
        cloudTexture.generateMipmaps = true;
        cloudTexture.minFilter = THREE.LinearMipmapLinearFilter;
        cloudTexture.magFilter = THREE.LinearFilter;

        const cloudMaterial = new CloudShaderMaterial({
            cloudTexture: cloudTexture,
            opacity: opacity || 0.8,
            alphaTest: alphaTest || 0.1,
            lightColor: 0xffffff
        });

        const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
        BodyRenderer.registerDetailMesh(cloudMesh, cloudRadius);

        cloudMesh.userData.rotationSpeed = rotationSpeed || 1.0;
        cloudMesh.userData.shaderMaterial = cloudMaterial;

        log.debug('BodyRenderer', `Created cloud system with planet shader for ${bodyName} (radius: ${cloudRadius.toFixed(3)}, opacity: ${opacity})`);

        return cloudMesh;
    }

    /**
     * Builds an atmosphere on a shell around the body.
     *
     * The configuration gives the shell's size as a multiple of the body's radius, whereas
     * the shader raymarches in a space normalised to the shell and needs the planet's radius
     * as a fraction of it — hence the reciprocal.
     *
     * The scattering parameters are passed through untouched;
     * {@link AtmosphereShaderMaterial} has the defaults and does the conversions.
     *
     * @param {Object} atmosphereConfig - Atmosphere configuration.
     * @param {number} [atmosphereConfig.color=0x87CEEB] - Colour the scattering is derived
     *   from.
     * @param {number} atmosphereConfig.radiusScale - Shell radius as a multiple of the body's.
     * @param {number} [atmosphereConfig.verticalOpticalDepth] - How hazy the air is.
     * @param {number} [atmosphereConfig.scaleHeight] - Density falloff height.
     * @param {number} [atmosphereConfig.scatteringPower] - How strongly wavelengths separate.
     * @param {number} [atmosphereConfig.mieStrength] - Weight of Mie against Rayleigh.
     * @param {number} [atmosphereConfig.mieDirection] - Mie anisotropy.
     * @param {number} bodyRadius - The body's radius in scene units.
     * @returns {THREE.Mesh} The atmosphere shell.
     */
    static createAtmosphere(atmosphereConfig, bodyRadius) {
        const {
            color, radiusScale,
            verticalOpticalDepth, scaleHeight, scatteringPower, mieStrength, mieDirection
        } = atmosphereConfig;

        const atmosphereRadius = bodyRadius * radiusScale;
        const atmosphereGeometry = BodyRenderer.createGeometry(atmosphereRadius);

        const atmosphereMaterial = new AtmosphereShaderMaterial({
            atmosphereColor: color || 0x87CEEB,

            planetRadiusRatio: 1 / radiusScale,

            verticalOpticalDepth,
            scaleHeight,
            scatteringPower,
            mieStrength,
            mieDirection
        });

        const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        BodyRenderer.registerDetailMesh(atmosphereMesh, atmosphereRadius);

        atmosphereMesh.userData.shaderMaterial = atmosphereMaterial;

        return atmosphereMesh;
    }

    /**
     * Retessellates a body for how large it currently appears.
     *
     * The screen radius is worked out properly from the camera's field of view and the
     * drawing buffer's height, not from distance alone: zooming in with the field of view
     * makes a body larger on screen without moving the camera, and a distance-only test would
     * miss that entirely.
     *
     * The buffer height is used rather than the canvas height, since that is what the body is
     * actually being rasterised into — on a high-density display they differ by the pixel
     * ratio.
     *
     * The cloud and atmosphere shells are set to the same tier as the surface. They are
     * concentric with it and only slightly larger, so any tier that suits one suits all three,
     * and matching them keeps their silhouettes from crossing.
     *
     * @param {Body} body - The body to retessellate.
     * @param {THREE.PerspectiveCamera} camera - Camera the frame will be drawn from.
     * @returns {void}
     */
    static updateDetail(body, camera) {
        if (!body?.mesh || !camera) return;

        const distance = body.group.position.distanceTo(camera.position);
        if (!(distance > 0)) return;

        const viewportHeight = SceneManager.renderer.getDrawingBufferSize(_bufferSize).y;
        const pixelsPerUnit = viewportHeight / (2 * Math.tan(camera.fov * Math.PI / 360));

        const screenRadius = (body.radius / distance) * pixelsPerUnit;
        const needed = segmentsForScreenRadius(screenRadius);

        applyDetailTier(body.mesh, selectDetailTier(needed, body.mesh.userData.detailSegments));
        if (body.clouds) {
            applyDetailTier(body.clouds, selectDetailTier(needed, body.clouds.userData.detailSegments));
        }
        if (body.atmosphere) {
            applyDetailTier(body.atmosphere, selectDetailTier(needed, body.atmosphere.userData.detailSegments));
        }
    }

    /**
     * Releases every cached tier geometry for a mesh.
     *
     * The cache holds every tier the mesh has ever been at, which for a body the camera has
     * flown past is most of them — so this has to be called when a body is removed, or that
     * GPU memory is never given back.
     *
     * @param {THREE.Mesh} mesh - The mesh whose cache to empty.
     * @returns {void}
     */
    static disposeDetailGeometries(mesh) {
        const cache = mesh?.userData?.detailGeometries;
        if (!cache) return;

        cache.forEach(geometry => geometry.dispose());
        cache.clear();
        mesh.userData.detailGeometries = null;
        mesh.userData.detailSegments = 0;
    }
}

export default BodyRenderer;