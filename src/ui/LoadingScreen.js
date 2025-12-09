/**
 * Loading Screen UI component for texture preloading
 */
export class LoadingScreen {
    constructor() {
        this.container = null;
        this.progressBar = null;
        this.progressText = null;
        this.statusText = null;
        this.isVisible = false;

        this.createLoadingScreen();
    }

    /**
     * Create the loading screen HTML elements and styles
     */
    createLoadingScreen() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'solar-system-loading-screen';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000000;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #ffffff;
            opacity: 1;
            transition: opacity 0.5s ease-out;
        `;

        // Create title
        const title = document.createElement('h1');
        title.textContent = 'Solar System';
        title.style.cssText = `
            font-size: 1.8rem;
            font-weight: 300;
            margin-bottom: 3rem;
            text-align: center;
            color: #ffffff;
            letter-spacing: 0.1em;
        `;

        // Create status text
        this.statusText = document.createElement('div');
        this.statusText.textContent = 'Loading...';
        this.statusText.style.cssText = `
            font-size: 0.9rem;
            font-weight: 300;
            margin-bottom: 2rem;
            text-align: center;
            color: #999999;
        `;

        // Create progress container
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 300px;
            height: 2px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 1px;
            overflow: hidden;
            position: relative;
            margin-bottom: 1rem;
        `;

        // Create progress bar
        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            height: 100%;
            width: 0%;
            background: #ffffff;
            transition: width 0.4s ease-out;
        `;

        // Create progress text
        this.progressText = document.createElement('div');
        this.progressText.textContent = '';
        this.progressText.style.cssText = `
            font-size: 0.8rem;
            text-align: center;
            color: #666666;
            margin-top: 0.5rem;
        `;

        // Assemble elements
        progressContainer.appendChild(this.progressBar);
        this.container.appendChild(title);
        this.container.appendChild(this.statusText);
        this.container.appendChild(progressContainer);
        this.container.appendChild(this.progressText);

        // Add CSS animations
        this.addAnimations();
    }

    /**
     * Add CSS keyframe animations
     */
    addAnimations() {
        if (document.getElementById('loading-screen-styles')) return;

        const style = document.createElement('style');
        style.id = 'loading-screen-styles';
        style.textContent = `
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Show the loading screen
     */
    show() {
        if (!this.isVisible) {
            document.body.appendChild(this.container);
            this.isVisible = true;
        }
        this.container.style.opacity = '1';
        this.container.style.display = 'flex';
    }

    /**
     * Hide the loading screen with fade animation
     * @param {number} duration - Fade duration in milliseconds (default: 500)
     * @returns {Promise} Promise that resolves when fade is complete
     */
    hide(duration = 500) {
        return new Promise(resolve => {
            if (!this.isVisible) {
                resolve();
                return;
            }

            this.container.style.opacity = '0';

            setTimeout(() => {
                if (this.container.parentNode) {
                    this.container.parentNode.removeChild(this.container);
                }
                this.isVisible = false;
                resolve();
            }, duration);
        });
    }

    /**
     * Update loading progress
     * @param {number} loaded - Number of textures loaded
     * @param {number} total - Total number of textures
     * @param {number} percentage - Completion percentage (0-100)
     */
    updateProgress(loaded, total, percentage) {
        this.progressBar.style.width = `${percentage}%`;
        this.progressText.textContent = `${Math.round(percentage)}%`;
    }

    /**
     * Update status message
     * @param {string} message - Status message to display
     */
    updateStatus(message) {
        this.statusText.textContent = message;
    }

    /**
     * Show completion message
     */
    showComplete() {
        this.statusText.textContent = 'Ready';
        this.progressText.textContent = '';
    }

    /**
     * Show error message
     * @param {string} errorMessage - Error message to display
     */
    showError(errorMessage) {
        this.statusText.textContent = 'Error loading';
        this.statusText.style.color = '#ff6b6b';
        this.progressBar.style.background = '#ff6b6b';
    }

    /**
     * Check if loading screen is currently visible
     * @returns {boolean} True if visible
     */
    isShown() {
        return this.isVisible;
    }

    /**
     * Clean up the loading screen
     */
    dispose() {
        this.hide(0);

        // Remove styles
        const styles = document.getElementById('loading-screen-styles');
        if (styles) {
            styles.remove();
        }
    }
}

export default LoadingScreen;