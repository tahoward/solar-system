import { log } from '../utils/Logger.js';

/**
 * Manages hierarchical relationships between celestial bodies
 */
export class HierarchyManager {
    constructor() {
        this.hierarchyMap = new Map(); // Maps body names to their hierarchy data
        this.currentSelectedBody = null; // Track currently selected body

        log.init('HierarchyManager', 'HierarchyManager');
    }

    /**
     * Register the hierarchy map for hierarchical visibility management
     * @param {Object} hierarchy - The hierarchy data from SolarSystemFactory
     */
    registerHierarchy(hierarchy) {
        this.hierarchyMap.clear();
        this._buildHierarchyMap(hierarchy, null);
        log.info('HierarchyManager', `Registered hierarchy with ${this.hierarchyMap.size} bodies`);

        // Debug: Log the hierarchy structure
        log.debug('HierarchyManager', 'Hierarchy structure:');
        this.hierarchyMap.forEach((data, name) => {
            const parentText = data.parent ? `parent: ${data.parent}` : 'parent: none (root)';
            const childrenText = data.children.length > 0 ? `children: [${data.children.join(', ')}]` : 'children: none';
            log.debug('HierarchyManager', `  ${name} -> ${parentText}, ${childrenText}`);
        });
    }

    /**
     * Recursively build the hierarchy map
     * @param {Object} node - Current node in the hierarchy
     * @param {string|null} parentName - Name of the parent body
     * @private
     */
    _buildHierarchyMap(node, parentName) {
        // Edge case: Invalid node
        if (!node) {
            log.warn('HierarchyManager', 'Skipping null/undefined node in hierarchy');
            return;
        }

        // Edge case: Node without body
        if (!node.body) {
            log.warn('HierarchyManager', 'Skipping node without body property');
            return;
        }

        // Edge case: Body without name
        const bodyName = node.body.name;
        if (!bodyName) {
            log.warn('HierarchyManager', 'Skipping body without name property');
            return;
        }

        const children = [];

        // Collect direct children with validation
        if (node.children && Array.isArray(node.children)) {
            node.children.forEach((child, index) => {
                // Edge case: Invalid child
                if (!child || !child.body || !child.body.name) {
                    log.warn('HierarchyManager', `Skipping invalid child ${index} of ${bodyName}`);
                    return;
                }

                const childName = child.body.name;

                // Edge case: Duplicate child names
                if (children.includes(childName)) {
                    log.warn('HierarchyManager', `Duplicate child name '${childName}' for parent '${bodyName}'`);
                    return;
                }

                // Edge case: Circular reference prevention
                if (childName === bodyName) {
                    log.error('HierarchyManager', `Circular reference detected: ${bodyName} cannot be child of itself`);
                    return;
                }

                children.push(childName);

                // Recursively process children
                try {
                    this._buildHierarchyMap(child, bodyName);
                } catch (error) {
                    log.error('HierarchyManager', `Error processing child ${childName} of ${bodyName}`, error);
                }
            });
        }

        // Edge case: Duplicate body names across hierarchy
        if (this.hierarchyMap.has(bodyName)) {
            log.error('HierarchyManager', `Duplicate body name '${bodyName}' in hierarchy - overwriting previous entry`);
        }

        this.hierarchyMap.set(bodyName, {
            parent: parentName,
            children: children,
            body: node.body
        });

    }

    /**
     * Set the currently selected body
     * @param {Object} body - The body that was selected
     */
    setSelectedBody(body) {
        if (!body) {
            log.warn('HierarchyManager', 'Cannot select null/undefined body');
            return;
        }

        this.currentSelectedBody = body;
    }

    /**
     * Get the currently selected body
     * @returns {Object|null} The currently selected body or null
     */
    getSelectedBody() {
        return this.currentSelectedBody;
    }

    /**
     * Clear the currently selected body
     */
    clearSelectedBody() {
        this.currentSelectedBody = null;
        log.debug('HierarchyManager', 'Cleared selected body');
    }

    /**
     * Get hierarchy data for a body
     * @param {string} bodyName - Name of the body
     * @returns {Object|null} Hierarchy data or null if not found
     */
    getHierarchyData(bodyName) {
        return this.hierarchyMap.get(bodyName) || null;
    }

    /**
     * Move a body under a different parent, for when it stops going round the one it started
     * with - a moon flung clear of its planet becomes a child of whatever it now orbits, so
     * that it is listed, shown and hidden along with that body's other children.
     *
     * @param {string} bodyName - Name of the body that has changed hands
     * @param {string} parentName - Name of the body it now orbits
     * @returns {boolean} True if the hierarchy changed
     */
    setParent(bodyName, parentName) {
        const bodyData = this.hierarchyMap.get(bodyName);
        const newParentData = this.hierarchyMap.get(parentName);

        if (!bodyData || !newParentData || bodyData.parent === parentName) return false;
        if (bodyName === parentName) {
            log.error('HierarchyManager', `${bodyName} cannot become a child of itself`);
            return false;
        }

        const oldParentData = this.hierarchyMap.get(bodyData.parent);
        if (oldParentData) {
            const index = oldParentData.children.indexOf(bodyName);
            if (index !== -1) oldParentData.children.splice(index, 1);
        }

        if (!newParentData.children.includes(bodyName)) {
            newParentData.children.push(bodyName);
        }

        log.info('HierarchyManager', `${bodyName} now orbits ${parentName}, was ${bodyData.parent}`);
        bodyData.parent = parentName;

        return true;
    }

    /**
     * Add a body that was not in the original hierarchy
     * @param {Object} body - The body to add
     * @param {string} parentName - Name of the body it hangs off
     * @returns {boolean} True if the body was added
     */
    addBody(body, parentName) {
        if (!body || !body.name) {
            log.warn('HierarchyManager', 'Cannot add a body without a name');
            return false;
        }

        if (this.hierarchyMap.has(body.name)) {
            log.error('HierarchyManager', `${body.name} is already in the hierarchy`);
            return false;
        }

        const parentData = this.hierarchyMap.get(parentName);
        if (!parentData) {
            log.error('HierarchyManager', `Cannot add ${body.name} under unknown parent ${parentName}`);
            return false;
        }

        parentData.children.push(body.name);
        this.hierarchyMap.set(body.name, { parent: parentName, children: [], body });

        log.info('HierarchyManager', `Added ${body.name} under ${parentName}`);
        return true;
    }

    /**
     * Remove a body from the hierarchy, handing any children to its parent
     * @param {string} bodyName - Name of the body to remove
     * @returns {boolean} True if the body was removed
     */
    removeBody(bodyName) {
        const bodyData = this.hierarchyMap.get(bodyName);
        if (!bodyData) return false;

        if (bodyData.parent === null) {
            log.error('HierarchyManager', `Refusing to remove root body ${bodyName}`);
            return false;
        }

        const parentData = this.hierarchyMap.get(bodyData.parent);
        if (parentData) {
            const index = parentData.children.indexOf(bodyName);
            if (index !== -1) parentData.children.splice(index, 1);

            // Orphans are adopted by the grandparent rather than dropped from the map, which
            // would leave them invisible to visibility and targeting for the rest of the session
            bodyData.children.forEach(childName => {
                const childData = this.hierarchyMap.get(childName);
                if (childData) childData.parent = bodyData.parent;
                if (!parentData.children.includes(childName)) parentData.children.push(childName);
            });
        }

        this.hierarchyMap.delete(bodyName);
        log.info('HierarchyManager', `Removed ${bodyName} from the hierarchy`);
        return true;
    }

    /**
     * Check if a body is a direct child of another body
     * @param {string} childName - Name of the potential child body
     * @param {string} parentName - Name of the potential parent body
     * @returns {boolean} True if childName is a direct child of parentName
     */
    isDirectChild(childName, parentName) {
        const parentData = this.hierarchyMap.get(parentName);
        return parentData ? parentData.children.includes(childName) : false;
    }

    /**
     * Check whether a body sits anywhere beneath another, however many levels down. Used to keep
     * a body from being drawn about something that is already drawn about it, which the hierarchy
     * has no way to express - both would have to be the other's centre.
     *
     * The walk is capped at the number of bodies known, so a hierarchy that has somehow come to
     * contain a loop answers rather than spinning.
     *
     * @param {string} bodyName - Name of the body that might be beneath the other
     * @param {string} ancestorName - Name of the body it might be beneath
     * @returns {boolean} True if bodyName is a descendant of ancestorName
     */
    isDescendantOf(bodyName, ancestorName) {
        let data = this.hierarchyMap.get(bodyName);

        for (let steps = this.hierarchyMap.size; data?.parent && steps > 0; steps--) {
            if (data.parent === ancestorName) return true;
            data = this.hierarchyMap.get(data.parent);
        }

        return false;
    }

    /**
     * Check if a body is a root body (has no parent)
     * @param {string} bodyName - Name of the body
     * @returns {boolean} True if root body
     */
    isRootBody(bodyName) {
        const hierarchyData = this.hierarchyMap.get(bodyName);
        return hierarchyData ? hierarchyData.parent === null : false;
    }

    /**
     * Get the root body name (the one with no parent)
     * @returns {string|null} Name of the root body, or null if none found
     */
    getRootBodyName() {
        for (const [name, data] of this.hierarchyMap) {
            if (data.parent === null) {
                return name;
            }
        }
        return null;
    }

    /**
     * Get all body names in the hierarchy
     * @returns {Array<string>} Array of all body names
     */
    getAllBodyNames() {
        return Array.from(this.hierarchyMap.keys());
    }


    /**
     * Clear all hierarchy data
     */
    clear() {
        const count = this.hierarchyMap.size;
        this.hierarchyMap.clear();
        this.currentSelectedBody = null;
        log.info('HierarchyManager', `Cleared hierarchy data (${count} bodies removed)`);
    }

    /**
     * Dispose and clean up resources
     */
    dispose() {
        log.dispose('HierarchyManager', 'resources');
        this.clear();
    }
}

export default HierarchyManager;
