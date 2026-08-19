import { log } from '../utils/Logger.js';

export class HierarchyManager {
    constructor() {
        this.hierarchyMap = new Map();
        this.currentSelectedBody = null;

        log.init('HierarchyManager', 'HierarchyManager');
    }

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

    setSelectedBody(body) {
        if (!body) {
            log.warn('HierarchyManager', 'Cannot select null/undefined body');
            return;
        }

        this.currentSelectedBody = body;
    }

    getSelectedBody() {
        return this.currentSelectedBody;
    }

    getHierarchyData(bodyName) {
        return this.hierarchyMap.get(bodyName) || null;
    }

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

    isDescendantOf(bodyName, ancestorName) {
        let data = this.hierarchyMap.get(bodyName);

        for (let steps = this.hierarchyMap.size; data?.parent && steps > 0; steps--) {
            if (data.parent === ancestorName) return true;
            data = this.hierarchyMap.get(data.parent);
        }

        return false;
    }

    getRootBodyName() {
        for (const [name, data] of this.hierarchyMap) {
            if (data.parent === null) {
                return name;
            }
        }
        return null;
    }

    clear() {
        const count = this.hierarchyMap.size;
        this.hierarchyMap.clear();
        this.currentSelectedBody = null;
        log.info('HierarchyManager', `Cleared hierarchy data (${count} bodies removed)`);
    }

    dispose() {
        log.dispose('HierarchyManager', 'resources');
        this.clear();
    }
}

export default HierarchyManager;
