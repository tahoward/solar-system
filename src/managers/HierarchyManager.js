import { log } from '../utils/Logger.js';

/**
 * Flat, name-keyed index of who orbits what.
 *
 * The hierarchy proper is a tree of nodes holding bodies, which is awkward to
 * query — answering "what is Europa's parent?" means walking it. This maintains a
 * `Map` alongside that tree so parent and child lookups are direct, which the
 * visibility rules and markers depend on every frame.
 *
 * Being a second copy of the structure, it has to be updated in step with the tree
 * whenever bodies are added, removed or reparented.
 */
export class HierarchyManager {
    /**
     * Creates an empty hierarchy index with nothing selected.
     */
    constructor() {
        this.hierarchyMap = new Map();
        this.currentSelectedBody = null;

        log.init('HierarchyManager', 'HierarchyManager');
    }

    /**
     * Rebuilds the index from a hierarchy tree, discarding any previous contents.
     *
     * @param {Object} hierarchy - Root hierarchy node.
     * @returns {void}
     */
    registerHierarchy(hierarchy) {
        this.hierarchyMap.clear();
        this._buildHierarchyMap(hierarchy, null);
        log.info('HierarchyManager', `Registered hierarchy with ${this.hierarchyMap.size} bodies`);

        log.debug('HierarchyManager', 'Hierarchy structure:');
        this.hierarchyMap.forEach((data, name) => {
            const parentText = data.parent ? `parent: ${data.parent}` : 'parent: none (root)';
            const childrenText = data.children.length > 0 ? `children: [${data.children.join(', ')}]` : 'children: none';
            log.debug('HierarchyManager', `  ${name} -> ${parentText}, ${childrenText}`);
        });
    }

    /**
     * Walks a hierarchy tree, adding an entry per body.
     *
     * Malformed input is logged and skipped rather than thrown on, so one bad entry
     * in the data cannot stop the whole system loading. Duplicate names and
     * self-parenting are both caught here, since either would corrupt a
     * name-keyed index or send lookups into an infinite loop.
     *
     * @private
     * @param {Object} node - Node to index, along with its descendants.
     * @param {string|null} parentName - Name of `node`'s parent; `null` at the root.
     * @returns {void}
     */
    _buildHierarchyMap(node, parentName) {
        if (!node) {
            log.warn('HierarchyManager', 'Skipping null/undefined node in hierarchy');
            return;
        }

        if (!node.body) {
            log.warn('HierarchyManager', 'Skipping node without body property');
            return;
        }

        const bodyName = node.body.name;
        if (!bodyName) {
            log.warn('HierarchyManager', 'Skipping body without name property');
            return;
        }

        const children = [];

        if (node.children && Array.isArray(node.children)) {
            node.children.forEach((child, index) => {
                if (!child || !child.body || !child.body.name) {
                    log.warn('HierarchyManager', `Skipping invalid child ${index} of ${bodyName}`);
                    return;
                }

                const childName = child.body.name;

                if (children.includes(childName)) {
                    log.warn('HierarchyManager', `Duplicate child name '${childName}' for parent '${bodyName}'`);
                    return;
                }

                if (childName === bodyName) {
                    log.error('HierarchyManager', `Circular reference detected: ${bodyName} cannot be child of itself`);
                    return;
                }

                children.push(childName);

                try {
                    this._buildHierarchyMap(child, bodyName);
                } catch (error) {
                    log.error('HierarchyManager', `Error processing child ${childName} of ${bodyName}`, error);
                }
            });
        }

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
     * Records which body is currently selected.
     *
     * @param {Body} body - Body to mark as selected.
     * @returns {void}
     */
    setSelectedBody(body) {
        if (!body) {
            log.warn('HierarchyManager', 'Cannot select null/undefined body');
            return;
        }

        this.currentSelectedBody = body;
    }

    /**
     * Returns the selected body.
     *
     * @returns {Body|null} The selection, or `null` if nothing is selected.
     */
    getSelectedBody() {
        return this.currentSelectedBody;
    }

    /**
     * Looks up a body's place in the hierarchy.
     *
     * @param {string} bodyName - Name of the body.
     * @returns {{parent: string|null, children: string[], body: Body}|null} Its entry,
     *   or `null` if the name is unknown.
     */
    getHierarchyData(bodyName) {
        return this.hierarchyMap.get(bodyName) || null;
    }

    /**
     * Moves a body under a different parent.
     *
     * Both sides are updated — the old parent's child list and the new one's — since
     * leaving the body listed under both would corrupt every subsequent traversal.
     *
     * Used when a body is captured by, or escapes, another's sphere of influence.
     *
     * @param {string} bodyName - Name of the body to move.
     * @param {string} parentName - Name of its new parent.
     * @returns {boolean} `true` if the reparenting happened; `false` if either name
     *   is unknown, the parent is already correct, or a body was asked to parent
     *   itself.
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
     * Indexes a body created after startup, such as a dropped mass.
     *
     * @param {Body} body - Body to add.
     * @param {string} parentName - Name of the body it orbits, which must already be
     *   indexed.
     * @returns {boolean} `true` if it was added; `false` if it has no name, is
     *   already present, or the parent is unknown.
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
     * Removes a body from the index, promoting its children to its parent.
     *
     * The children are re-attached rather than dropped, so removing a planet leaves
     * its moons orbiting the Sun instead of vanishing with it.
     *
     * The root cannot be removed, since the hierarchy would be left rootless.
     *
     * @param {string} bodyName - Name of the body to remove.
     * @returns {boolean} `true` if it was removed; `false` if the name is unknown or
     *   names the root.
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
     * Tests whether one body lies below another in the hierarchy.
     *
     * The walk is bounded by the number of bodies, so a cycle introduced by bad data
     * or a mistaken reparenting returns `false` instead of hanging.
     *
     * @param {string} bodyName - Name of the body to test.
     * @param {string} ancestorName - Name of the possible ancestor.
     * @returns {boolean} `true` if `bodyName` is a descendant of `ancestorName`.
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
     * Finds the name of the body at the top of the hierarchy.
     *
     * @returns {string|null} The root's name — normally `'Sun'` — or `null` if the
     *   index is empty.
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
     * Empties the index and clears the selection.
     *
     * @returns {void}
     */
    clear() {
        const count = this.hierarchyMap.size;
        this.hierarchyMap.clear();
        this.currentSelectedBody = null;
        log.info('HierarchyManager', `Cleared hierarchy data (${count} bodies removed)`);
    }

    /**
     * Empties the index.
     *
     * @returns {void}
     */
    dispose() {
        log.dispose('HierarchyManager', 'resources');
        this.clear();
    }
}

export default HierarchyManager;
