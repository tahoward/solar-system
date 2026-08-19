import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import markerSVG from '../../assets/marker.svg'
import SceneManager from '../managers/SceneManager.js';
import { MARKER, TARGETING } from '../constants.js';
import { log } from '../utils/Logger.js';

const _worldPosition = new THREE.Vector3();

/**
 * Loads the marker SVG once and hands out clones of the resulting geometry.
 *
 * Every body has a marker, so parsing the SVG per marker would be wasteful and
 * would fire dozens of concurrent loads at startup. This is a singleton with a
 * shared in-flight promise, so the first caller triggers the load and the rest
 * await it.
 */
class SVGTemplateManager {
    /**
     * The singleton instance, assigned on first construction.
     *
     * @type {?SVGTemplateManager}
     */
    static instance = null;

    /**
     * The in-flight load, shared so concurrent callers await one parse.
     *
     * @type {?Promise<void>}
     */
    static loadingPromise = null;

    /**
     * Returns the existing instance if there is one, otherwise initialises it.
     */
    constructor() {
        if (SVGTemplateManager.instance) {
            return SVGTemplateManager.instance;
        }

        this.loader = new SVGLoader();
        this.svgTemplate = null;
        this.isLoaded = false;

        SVGTemplateManager.instance = this;
    }

    /**
     * Returns a fresh copy of the marker template, loading it if necessary.
     *
     * @async
     * @throws {Error} If the SVG fails to load or parse.
     * @returns {Promise<THREE.Group>} A clone of the template, safe to modify.
     */
    async loadTemplate() {
        if (this.isLoaded && this.svgTemplate) {
            return this.svgTemplate.clone();
        }

        if (SVGTemplateManager.loadingPromise) {
            await SVGTemplateManager.loadingPromise;
            return this.svgTemplate.clone();
        }

        SVGTemplateManager.loadingPromise = this._loadSVGContent();

        try {
            await SVGTemplateManager.loadingPromise;
            return this.svgTemplate.clone();
        } catch (error) {
            log.error('SVGTemplateManager', 'Failed to load marker SVG', error);
            SVGTemplateManager.loadingPromise = null;
            throw error;
        }
    }

    /**
     * Loads the SVG and converts each of its paths into a mesh.
     *
     * Meshes are named after their source SVG node so individual parts can be
     * found later — {@link Marker} looks up `path#Shape` to recolour it. Render
     * order is assigned in document order to preserve the artwork's layering,
     * since the shapes are coplanar and depth testing cannot separate them.
     *
     * @private
     * @async
     * @throws {Error} If the SVG fails to load or parse.
     * @returns {Promise<void>} Resolves once `svgTemplate` is populated.
     */
    async _loadSVGContent() {
        try {
            const svgContent = await this.loader.loadAsync(markerSVG);
            const svgObject = new THREE.Group();
            let renderOrder = TARGETING.INITIAL_TARGET_INDEX;

            svgContent.paths.forEach(path => {
                const material = new THREE.MeshBasicMaterial({
                    color: path.color,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });

                const shapes = SVGLoader.createShapes(path);
                shapes.forEach(shape => {
                    const geometry = new THREE.ShapeGeometry(shape);
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.name = `${path.userData.node.nodeName}#${path.userData.node.id}`;
                    mesh.renderOrder = renderOrder++;
                    svgObject.add(mesh);
                });
            });

            svgObject.name = svgContent.xml.id;
            this.svgTemplate = svgObject;
            this.isLoaded = true;

        } catch (error) {
            log.error('SVGTemplateManager', 'Error loading SVG template', error);
            throw error;
        }
    }

}

const svgTemplateManager = new SVGTemplateManager();


/**
 * Clickable screen-space label that floats above a body.
 *
 * Planets are only a few pixels across from most viewpoints, so markers are what
 * makes them findable and selectable. Each marker counter-scales with camera
 * distance to hold a constant apparent size, and turns to face the camera every
 * frame.
 *
 * Construction is asynchronous: the marker registers itself immediately but its
 * geometry appears once the shared SVG template has loaded, so callers must not
 * assume `group` exists.
 */
class Marker {
    /**
     * Creates a marker for a body and begins loading its geometry.
     *
     * @param {Body} body - Body this marker labels; the marker attaches to its group.
     * @param {number} [scale] - Base geometry scale, defaulting to the configured
     *   marker scale times the scene scale.
     * @param {number} [targetScreenSize] - Apparent size to hold as the camera
     *   moves, as a fraction of distance.
     */
    constructor(body, scale = MARKER.DEFAULT_SCALE * SceneManager.scale, targetScreenSize = MARKER.DEFAULT_SCREEN_SIZE) {
        this.body = body;
        this.scale = scale;
        this.targetScreenSize = targetScreenSize;
        this.opacity = MARKER.FULL_OPACITY;
        this.group = null;
        this.isReady = false;
        this.interactionDisabled = false;

        this._initializeAsync();

        SceneManager.registerMarker(this);
    }

    /**
     * Awaits the SVG template and builds the marker's scene objects.
     *
     * A hide request arriving before the geometry exists is recorded and applied
     * here. Failures are logged and leave `isReady` false rather than throwing
     * into an unawaited promise.
     *
     * @private
     * @async
     * @returns {Promise<void>} Resolves once the marker is built or has failed.
     */
    async _initializeAsync() {
        try {
            const svgTemplate = await svgTemplateManager.loadTemplate();
            this.group = this.#build(svgTemplate);

            if (this._shouldBeHidden) {
                this.group.visible = false;
            }

            this.isReady = true;
        } catch (error) {
            log.error('Marker', `Failed to initialize for ${this.body.name || 'unnamed body'}`, error);
            this.isReady = false;
        }
    }

    /**
     * Assembles the marker's scene graph, materials and click handling.
     *
     * Three nested groups each own one concern: the outer group takes the camera's
     * orientation, the middle one holds the height offset above the body, and the
     * innermost carries the artwork. Separating them keeps billboarding from
     * disturbing the offset.
     *
     * Materials are cloned per marker so that recolouring one — from the body's
     * `markerColor` — does not affect the shared template. Clicking selects the
     * body, and also emits a `planetSelected` window event for the UI. Only
     * top-level bodies start out interactive, so moons cannot be clicked until
     * their system is entered.
     *
     * @private
     * @param {THREE.Group} svgTemplate - Template clone to build from.
     * @returns {THREE.Group} The outermost orientation group, added to the body.
     */
    #build(svgTemplate) {
        const orientationGroup = new THREE.Group();
        const positionGroup = new THREE.Group();
        const markerContainer = new THREE.Group();

        this.marker = svgTemplate.clone()

        this.marker.addEventListener("click", (event) => {
            event.stopPropagation();

            SceneManager.setTargetSmooth(this.body.group);

            SceneManager.onBodySelected(this.body);

            window.dispatchEvent(new CustomEvent('planetSelected', {
                detail: { bodyName: this.body.name }
            }));
        });

        const shouldBeInitiallyInteractive = this.#shouldBeInitiallyInteractive();
        if (shouldBeInitiallyInteractive) {
            SceneManager.interactionManager.add(this.marker);
        } else {
            this.interactionDisabled = true;
        }

        this.materials = [];

        this.marker.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = this.opacity;
                this.materials.push(child.material);
            }
        });

        const shapeMesh = this.marker.children.find(mesh => mesh.name === "path#Shape");
        if (shapeMesh) {
            if (this.body.markerColor) {
                shapeMesh.material.color.copy(this.body.markerColor);
            } else {
                log.error('Marker', `No markerColor attribute set for ${this.body.name}`);
                shapeMesh.material.color.setHex(0xFF0000);
            }
        }

        this.marker.scale.set(this.scale, -this.scale);

        markerContainer.add(this.marker);
        const boundingBox = new THREE.Box3().setFromObject(this.marker);
        this.size = boundingBox.getSize(new THREE.Vector2());
        this.marker.position.setX(this.size.x / -MARKER.CENTERING_DIVISOR);

        positionGroup.add(markerContainer);
        orientationGroup.add(positionGroup);
        this.body.group.add(orientationGroup);

        const markerHeight = boundingBox.max.y - boundingBox.min.y;
        this.markerHeight = markerHeight;
        this.baseYOffset = this.body.radius + (MARKER.POSITION_OFFSET_MULTIPLIER * this.body.radius);
        positionGroup.position.set(0, this.markerHeight + this.baseYOffset, 0);

        this.orientationGroup = orientationGroup;
        this.positionGroup = positionGroup;

        return orientationGroup;
    }


    /**
     * Rescales the marker so it holds a constant apparent size.
     *
     * Scale is set proportional to camera distance, which cancels perspective
     * shrinkage. For the currently targeted body the distance is measured to the
     * controls' target instead of the body itself, which keeps the marker steady
     * while the camera orbits.
     *
     * The height offset is divided back out, since it would otherwise be
     * magnified by the same scale and push the marker away from its body.
     *
     * @private
     * @returns {void}
     */
    #scale() {
        let camDistance;

        if (SceneManager.target && SceneManager.target === this.body.group) {
            camDistance = SceneManager.camera.position.distanceTo(SceneManager.controls.target);
        } else {
            this.body.group.getWorldPosition(_worldPosition);
            camDistance = SceneManager.camera.position.distanceTo(_worldPosition);
        }

        const globalMultiplier = SceneManager.getMarkerSizeMultiplier();

        const baseSizeAtDistance = camDistance * this.targetScreenSize * globalMultiplier;

        this.orientationGroup.scale.set(baseSizeAtDistance, baseSizeAtDistance, baseSizeAtDistance);

        const adjustedYOffset = this.baseYOffset / baseSizeAtDistance;
        this.positionGroup.position.setY(this.markerHeight + adjustedYOffset);
    }

    /**
     * Turns the marker to face the camera.
     *
     * Copies the camera's rotation outright rather than using `lookAt`, so all
     * markers stay parallel to the screen plane instead of fanning towards the
     * camera's position.
     *
     * @private
     * @returns {void}
     */
    #orientate() {
        this.orientationGroup.quaternion.copy(SceneManager.camera.quaternion);
    }

    /**
     * Decides whether this marker accepts clicks from the outset.
     *
     * Only the Sun and the bodies directly orbiting it start out clickable;
     * moons are enabled later, once their system is the focus. Without this,
     * distant moons would overlap their planet and make it hard to click.
     *
     * @private
     * @returns {boolean} `true` if the marker should be interactive now; also the
     *   fallback when hierarchy data is unavailable.
     */
    #shouldBeInitiallyInteractive() {
        if (!this.body) return true;

        const bodyName = this.body.name;

        const hierarchyData = SceneManager.markerManager?.hierarchyMap?.get(bodyName);

        if (!hierarchyData) {
            log.warn('Marker', `No hierarchy data for ${bodyName}, defaulting to interactive`);
            return true;
        }

        const shouldBeInteractive = hierarchyData.parent === null || hierarchyData.parent === 'Sun';

        return shouldBeInteractive;
    }

    /**
     * Fades the marker out and stops it accepting clicks.
     *
     * Opacity is used rather than visibility so the marker can be faded smoothly,
     * but interaction is removed outright so an invisible marker cannot be hit.
     *
     * @returns {void}
     */
    hide() {
        this.disableInteraction();

        this.opacity = MARKER.ZERO_OPACITY;
        if (this.materials) {
            this.materials.forEach(material => {
                material.opacity = this.opacity;
            });
        }
    }

    /**
     * Fades the marker back in, restoring interaction unless it was disabled.
     *
     * @returns {void}
     */
    show() {
        this.opacity = MARKER.FULL_OPACITY;
        if (this.materials) {
            this.materials.forEach(material => {
                material.opacity = this.opacity;
            });
        }

        if (!this.interactionDisabled) {
            this.enableInteraction();
        }
    }

    /**
     * Registers the marker for pointer events, unless interaction is disabled.
     *
     * @returns {void}
     */
    enableInteraction() {
        if (this.marker && !this.interactionDisabled) {
            SceneManager.interactionManager.add(this.marker);
        }
    }

    /**
     * Removes the marker from pointer handling and latches it off.
     *
     * The latch means a later {@link Marker#show} will not silently re-enable
     * clicks; {@link Marker#reenableInteraction} is required.
     *
     * @returns {void}
     */
    disableInteraction() {
        if (this.marker) {
            SceneManager.interactionManager.remove(this.marker);
            this.interactionDisabled = true;
        }
    }

    /**
     * Clears the interaction latch and re-registers the marker for clicks.
     *
     * @returns {void}
     */
    reenableInteraction() {
        this.interactionDisabled = false;
        this.enableInteraction();
    }

    /**
     * Re-aims and rescales the marker for the current frame.
     *
     * Returns early for markers that are still loading, faded out or hidden,
     * which keeps the cost off the many markers not currently on screen.
     *
     * @returns {void}
     */
    update() {
        if (!this.group) return;

        if (this.opacity <= 0 || !this.group.visible) return;

        this.#orientate();

        this.#scale();
    }

    /**
     * Disposes the marker's materials and geometry and detaches it.
     *
     * Only the per-marker clones are released; the shared SVG template is left
     * intact for other markers.
     *
     * @returns {void}
     */
    dispose() {
        if (this.materials) {
            this.materials.forEach(material => {
                if (material && typeof material.dispose === 'function') {
                    material.dispose();
                }
            });
            this.materials = null;
        }

        if (this.marker) {
            this.marker.traverse((child) => {
                if (child.geometry && typeof child.geometry.dispose === 'function') {
                    child.geometry.dispose();
                }
            });

            SceneManager.interactionManager.remove(this.marker);

            if (this.marker.parent) {
                this.marker.parent.remove(this.marker);
            }
        }

        SceneManager.unregisterMarker(this);

        this.group = null;
        this.marker = null;
        this.orientationGroup = null;
        this.positionGroup = null;
        this.body = null;
    }
}

export default Marker;
