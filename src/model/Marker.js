import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import markerSVG from '../../assets/marker.svg'
import SceneManager from '../managers/SceneManager.js';
import { MARKER, TARGETING } from '../constants.js';
import { log } from '../utils/Logger.js';

const _worldPosition = new THREE.Vector3();

class SVGTemplateManager {
    static instance = null;
    static loadingPromise = null;

    constructor() {
        if (SVGTemplateManager.instance) {
            return SVGTemplateManager.instance;
        }

        this.loader = new SVGLoader();
        this.svgTemplate = null;
        this.isLoaded = false;

        SVGTemplateManager.instance = this;
    }

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

    getTemplateSync() {
        if (this.isLoaded && this.svgTemplate) {
            return this.svgTemplate.clone();
        }
        return null;
    }

    isTemplateLoaded() {
        return this.isLoaded;
    }
}

const svgTemplateManager = new SVGTemplateManager();


class Marker {
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

    #orientate() {
        this.orientationGroup.quaternion.copy(SceneManager.camera.quaternion);
    }

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

    hide() {
        this.disableInteraction();

        this.opacity = MARKER.ZERO_OPACITY;
        if (this.materials) {
            this.materials.forEach(material => {
                material.opacity = this.opacity;
            });
        }
    }

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

    enableInteraction() {
        if (this.marker && !this.interactionDisabled) {
            SceneManager.interactionManager.add(this.marker);
        }
    }

    disableInteraction() {
        if (this.marker) {
            SceneManager.interactionManager.remove(this.marker);
            this.interactionDisabled = true;
        }
    }

    reenableInteraction() {
        this.interactionDisabled = false;
        this.enableInteraction();
    }

    update() {
        if (!this.group) return;

        if (this.opacity <= 0 || !this.group.visible) return;

        this.#orientate();

        this.#scale();
    }

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

    applyMarkerColor(shapeMesh) {
        const markerColor = this.body.markerColor || 0xffffff;
        shapeMesh.material.color.setHex(markerColor);
    }
}

export default Marker;
