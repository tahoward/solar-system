import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
// Tween imports removed - no longer needed for instant marker visibility changes
import markerSVG from '../../assets/marker.svg'
import SceneManager from '../managers/SceneManager.js';
import { MARKER, TARGETING } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * SVG Template Manager - handles loading and caching of marker SVG template
 */
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

    /**
     * Load the SVG template (singleton pattern with caching)
     * @returns {Promise<THREE.Group>} Promise that resolves to the SVG template
     */
    async loadTemplate() {
        // Return cached result if already loaded
        if (this.isLoaded && this.svgTemplate) {
            return this.svgTemplate.clone();
        }

        // Return existing loading promise if already in progress
        if (SVGTemplateManager.loadingPromise) {
            await SVGTemplateManager.loadingPromise;
            return this.svgTemplate.clone();
        }

        // Start loading
        SVGTemplateManager.loadingPromise = this._loadSVGContent();

        try {
            await SVGTemplateManager.loadingPromise;
            return this.svgTemplate.clone();
        } catch (error) {
            log.error('SVGTemplateManager', 'Failed to load marker SVG', error);
            // Reset loading promise so we can retry
            SVGTemplateManager.loadingPromise = null;
            throw error;
        }
    }

    /**
     * Internal method to load and process SVG content
     * @private
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

    /**
     * Get template synchronously (only works if already loaded)
     * @returns {THREE.Group|null} Cloned SVG template or null if not loaded
     */
    getTemplateSync() {
        if (this.isLoaded && this.svgTemplate) {
            return this.svgTemplate.clone();
        }
        return null;
    }

    /**
     * Check if template is loaded
     * @returns {boolean} True if template is loaded and ready
     */
    isTemplateLoaded() {
        return this.isLoaded;
    }
}

// Create singleton instance
const svgTemplateManager = new SVGTemplateManager();


class Marker {
    constructor(body, scale = MARKER.DEFAULT_SCALE * SceneManager.scale, targetScreenSize = MARKER.DEFAULT_SCREEN_SIZE) {
        this.body = body;
        this.scale = scale;
        this.targetScreenSize = targetScreenSize; // Target size as fraction of screen height
        this.opacity = MARKER.FULL_OPACITY; // Current opacity
        // fadeTween removed - no longer using animations
        this.group = null; // Will be set when SVG loads
        this.isReady = false;
        this.interactionDisabled = false; // Track interaction state

        // Initialize asynchronously
        this._initializeAsync();

        // Register with SceneManager for fade management
        SceneManager.registerMarker(this);
    }

    /**
     * Initialize the marker asynchronously
     * @private
     */
    async _initializeAsync() {
        try {
            const svgTemplate = await svgTemplateManager.loadTemplate();
            this.group = this.#build(svgTemplate);

            // Check if this marker should be hidden (set by MarkerManager before it was ready)
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
        // Create nested group structure:
        // - orientationGroup: handles camera-facing rotation (outer group)
        // - positionGroup: handles Y-position offset (inner group)
        // - markerContainer: contains the actual marker
        const orientationGroup = new THREE.Group();
        const positionGroup = new THREE.Group();
        const markerContainer = new THREE.Group();

        this.marker = svgTemplate.clone()

        this.marker.addEventListener("click", (event) => {
            event.stopPropagation();

            // Use smooth transition for all bodies including Sun
            SceneManager.setTargetSmooth(this.body.group);

            // Handle body selection through SceneManager (this will properly manage marker fading)
            SceneManager.onBodySelected(this.body);

            // Trigger custom event to update the keyboard control system
            window.dispatchEvent(new CustomEvent('planetSelected', {
                detail: { bodyName: this.body.name }
            }));
        });

        // Only add to interaction manager initially if this is a root body or direct child of Sun
        // Other bodies will be made interactive by the hierarchical visibility system
        const shouldBeInitiallyInteractive = this.#shouldBeInitiallyInteractive();
        if (shouldBeInitiallyInteractive) {
            SceneManager.interactionManager.add(this.marker);
        } else {
            this.interactionDisabled = true; // Mark as initially disabled
        }

        // Store material references for opacity updates - do this BEFORE modifying materials
        this.materials = [];

        // First, traverse and collect/configure all materials
        this.marker.traverse((child) => {
            if (child.isMesh && child.material) {
                // Clone the material to avoid affecting the original SVG template
                child.material = child.material.clone();
                // Ensure all materials support transparency
                child.material.transparent = true;
                child.material.opacity = this.opacity;
                this.materials.push(child.material);
            }
        });

        // Then set the specific shape color (this will already be in our materials array)
        const shapeMesh = this.marker.children.find(mesh => mesh.name === "path#Shape");
        if (shapeMesh) {
            // Use explicit markerColor attribute - must be set for all bodies
            if (this.body.markerColor) {
                shapeMesh.material.color.copy(this.body.markerColor);
            } else {
                log.error('Marker', `No markerColor attribute set for ${this.body.name}`);
                // Fallback to red to make missing markerColor obvious
                shapeMesh.material.color.setHex(0xFF0000);
            }
        }

        // Invert Y Axis to avoid upside down SVG.
        this.marker.scale.set(this.scale, -this.scale);

        // Add marker to container, container to position group, position group to orientation group
        markerContainer.add(this.marker);
        const boundingBox = new THREE.Box3().setFromObject(this.marker);
        this.size = boundingBox.getSize(new THREE.Vector2());
        this.marker.position.setX(this.size.x / -MARKER.CENTERING_DIVISOR);

        // Set up the group hierarchy
        positionGroup.add(markerContainer);
        orientationGroup.add(positionGroup);
        this.body.group.add(orientationGroup);

        // Store components for dynamic adjustment
        const markerHeight = boundingBox.max.y - boundingBox.min.y;
        this.markerHeight = markerHeight;
        this.baseYOffset = this.body.radius + (MARKER.POSITION_OFFSET_MULTIPLIER * this.body.radius);
        positionGroup.position.set(0, this.markerHeight + this.baseYOffset, 0);

        // Store references to both groups
        this.orientationGroup = orientationGroup;
        this.positionGroup = positionGroup;

        return orientationGroup;
    }


    #scale() {
        // Use orbit controls distance when available, fallback to direct distance calculation
        // This should give more consistent scaling when orbiting around a target
        let camDistance;

        if (SceneManager.target && SceneManager.target === this.body.group) {
            // If this is the currently targeted body, use orbit controls distance
            camDistance = SceneManager.camera.position.distanceTo(SceneManager.controls.target);
        } else {
            // For non-targeted bodies, use direct distance to body center (world position)
            const worldPos = new THREE.Vector3();
            this.body.group.getWorldPosition(worldPos);
            camDistance = SceneManager.camera.position.distanceTo(worldPos);
        }

        const globalMultiplier = SceneManager.getMarkerSizeMultiplier();

        // Simple screen-size scaling: scale proportional to distance
        // This ensures markers appear the same size on screen regardless of zoom
        const baseSizeAtDistance = camDistance * this.targetScreenSize * globalMultiplier;

        // Apply the scale to the orientation group (outer group)
        this.orientationGroup.scale.set(baseSizeAtDistance, baseSizeAtDistance, baseSizeAtDistance);

        // Adjust Y position to compensate for scaling and keep marker above body surface
        // When orientation group scales down, we need to increase Y position proportionally
        // Marker height stays constant (already handled by orientation group scaling)
        // Only the clearance offset needs inverse scaling adjustment
        const adjustedYOffset = this.baseYOffset / baseSizeAtDistance;
        this.positionGroup.position.setY(this.markerHeight + adjustedYOffset);
    }

    #orientate() {
        // Orientation group (outer group) handles camera-facing rotation
        this.orientationGroup.quaternion.copy(SceneManager.camera.quaternion);
    }

    /**
     * Determine if this marker should be initially interactive
     * Only Sun and planets (direct children of Sun) should be initially interactive
     * Moons and deeper children should be disabled until their parent is selected
     * @private
     */
    #shouldBeInitiallyInteractive() {
        if (!this.body) return true; // Safe fallback

        const bodyName = this.body.name;

        // Check against the hierarchy system in SceneManager
        const hierarchyData = SceneManager.markerManager?.hierarchyMap?.get(bodyName);

        if (!hierarchyData) {
            log.warn('Marker', `No hierarchy data for ${bodyName}, defaulting to interactive`);
            return true;
        }

        // Use hierarchy data to determine if this should be initially interactive
        // Only bodies with no parent (Sun) or parent = Sun (planets) should be initially interactive
        const shouldBeInteractive = hierarchyData.parent === null || hierarchyData.parent === 'Sun';

        return shouldBeInteractive;
    }

    hide() {
        // Disable interaction immediately when hiding
        this.disableInteraction();

        // Instantly hide the marker
        this.opacity = MARKER.ZERO_OPACITY;
        if (this.materials) {
            this.materials.forEach(material => {
                material.opacity = this.opacity;
            });
        }
    }

    show() {
        // Instantly show the marker
        this.opacity = MARKER.FULL_OPACITY;
        if (this.materials) {
            this.materials.forEach(material => {
                material.opacity = this.opacity;
            });
        }

        // Re-enable interaction when fully visible (only if not manually disabled)
        if (!this.interactionDisabled) {
            this.enableInteraction();
        }
    }

    /**
     * Enable interaction for this marker
     */
    enableInteraction() {
        if (this.marker && !this.interactionDisabled) {
            SceneManager.interactionManager.add(this.marker);
        }
    }

    /**
     * Disable interaction for this marker
     */
    disableInteraction() {
        if (this.marker) {
            SceneManager.interactionManager.remove(this.marker);
            this.interactionDisabled = true;
        }
    }

    /**
     * Re-enable interaction for this marker
     */
    reenableInteraction() {
        this.interactionDisabled = false;
        this.enableInteraction();
    }

    update() {
        if (!this.group) return;

        // Keep camera orientation
        this.#orientate();

        // Scale based on distance from camera
        this.#scale();
    }

    /**
     * Clean up marker resources and unregister from SceneManager
     */
    dispose() {
        // Dispose of materials to prevent memory leaks
        if (this.materials) {
            this.materials.forEach(material => {
                if (material && typeof material.dispose === 'function') {
                    material.dispose();
                }
            });
            this.materials = null;
        }

        // Dispose of marker geometry and remove from scene
        if (this.marker) {
            this.marker.traverse((child) => {
                if (child.geometry && typeof child.geometry.dispose === 'function') {
                    child.geometry.dispose();
                }
            });

            // Remove from interaction manager
            SceneManager.interactionManager.remove(this.marker);

            // Remove from parent (body group)
            if (this.marker.parent) {
                this.marker.parent.remove(this.marker);
            }
        }

        // Unregister from SceneManager
        SceneManager.unregisterMarker(this);

        // Clear references
        this.group = null;
        this.marker = null;
        this.orientationGroup = null;
        this.positionGroup = null;
        this.body = null;
    }

    /**
     * Apply marker color from body configuration
     * @param {THREE.Mesh} shapeMesh - The marker shape mesh to apply color to
     */
    applyMarkerColor(shapeMesh) {
        // Use the predefined markerColor from the body configuration
        const markerColor = this.body.markerColor || 0xffffff;
        shapeMesh.material.color.setHex(markerColor);
    }
}

export default Marker;
