/**
 * The black screen with a progress bar shown while textures load.
 *
 * Built entirely in JavaScript with inline styles rather than markup in the page. That keeps
 * it self-contained — it can be shown and torn down without the host page needing to know it
 * exists — and means it has no stylesheet to wait on, which matters for something whose whole
 * job is to be on screen before anything else is ready.
 *
 * Sits at a very high z-index and covers the viewport, so the scene can be built underneath
 * it in whatever half-finished state it likes.
 */
export class LoadingScreen {
    /**
     * Builds the elements but does not attach them.
     *
     * Nothing appears until {@link LoadingScreen#show} is called, so a caller can construct
     * this early and decide later whether it is needed.
     */
    constructor() {
        this.container = null;
        this.progressBar = null;
        this.progressText = null;
        this.statusText = null;
        this.isVisible = false;

        this.createLoadingScreen();
    }

    /**
     * Assembles the overlay: title, status line, progress bar and percentage.
     *
     * The bar's fill has a CSS width transition, which is what makes the progress glide
     * between values instead of stepping. Texture loads complete in bursts, so without it the
     * bar would jump and stall in a way that reads as a hang.
     *
     * @returns {void}
     */
    createLoadingScreen() {
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

        this.statusText = document.createElement('div');
        this.statusText.textContent = 'Loading...';
        this.statusText.style.cssText = `
            font-size: 0.9rem;
            font-weight: 300;
            margin-bottom: 2rem;
            text-align: center;
            color: #999999;
        `;

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

        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            height: 100%;
            width: 0%;
            background: #ffffff;
            transition: width 0.4s ease-out;
        `;

        this.progressText = document.createElement('div');
        this.progressText.textContent = '';
        this.progressText.style.cssText = `
            font-size: 0.8rem;
            text-align: center;
            color: #666666;
            margin-top: 0.5rem;
        `;

        progressContainer.appendChild(this.progressBar);
        this.container.appendChild(title);
        this.container.appendChild(this.statusText);
        this.container.appendChild(progressContainer);
        this.container.appendChild(this.progressText);

        this.addAnimations();
    }

    /**
     * Injects the keyframes into the document head, once.
     *
     * Keyframes cannot be expressed as inline styles, so this is the one part that has to go
     * into a stylesheet. Guarded by id so a second loading screen does not add a duplicate.
     *
     * @returns {void}
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
     * Puts the overlay on screen.
     *
     * Attaches on first call only; later calls just make the existing element visible again,
     * which is what allows it to be reshown after a fade-out that has not yet removed it.
     *
     * @returns {void}
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
     * Fades the overlay out and removes it.
     *
     * The promise resolves after the element is actually gone, not when the fade starts, so a
     * caller can wait for the screen to be clear before doing anything that would be visible
     * through it.
     *
     * The duration is only a timer — the fade itself is the CSS transition set in
     * {@link LoadingScreen#createLoadingScreen} — so it should match that transition, and
     * passing 0 removes the element immediately.
     *
     * @param {number} [duration=500] - Milliseconds to wait before removing the element.
     * @returns {Promise<void>} Resolves once the overlay has been removed.
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
     * Moves the bar to a new position.
     *
     * @param {number} loaded - Assets finished so far. Accepted for callers that report counts,
     *   but the display uses the percentage.
     * @param {number} total - Assets expected in total. Also unused by the display.
     * @param {number} percentage - Progress from 0 to 100; this is what is shown.
     * @returns {void}
     */
    updateProgress(loaded, total, percentage) {
        this.progressBar.style.width = `${percentage}%`;
        this.progressText.textContent = `${Math.round(percentage)}%`;
    }

    /**
     * Replaces the line above the bar.
     *
     * @param {string} message - What is happening, e.g. which stage is running.
     * @returns {void}
     */
    updateStatus(message) {
        this.statusText.textContent = message;
    }

    /**
     * Marks loading as finished.
     *
     * The percentage is cleared rather than set to 100: the bar is already full, and "100%"
     * lingering under it is noise.
     *
     * @returns {void}
     */
    showComplete() {
        this.statusText.textContent = 'Ready';
        this.progressText.textContent = '';
    }

    /**
     * Turns the overlay red to show loading failed.
     *
     * The overlay is deliberately left on screen: whatever failed to load, the scene behind is
     * incomplete, and revealing it would be worse than saying so.
     *
     * @param {string} errorMessage - The error. Not displayed — the status line shows a fixed
     *   message instead, since a raw loader error means nothing to a viewer.
     * @returns {void}
     */
    showError(errorMessage) {
        this.statusText.textContent = 'Error loading';
        this.statusText.style.color = '#ff6b6b';
        this.progressBar.style.background = '#ff6b6b';
    }

    /**
     * Removes the overlay and its injected stylesheet.
     *
     * Hides with no delay, since this is a teardown rather than a transition, and takes the
     * stylesheet with it so nothing is left behind in the document head.
     *
     * @returns {void}
     */
    dispose() {
        this.hide(0);

        const styles = document.getElementById('loading-screen-styles');
        if (styles) {
            styles.remove();
        }
    }
}

export default LoadingScreen;