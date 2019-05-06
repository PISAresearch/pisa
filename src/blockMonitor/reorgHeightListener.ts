/**
 * A store for block height listeners
 */
export class ReorgHeightListenerStore {
    private listeners: {
        [height: number]: Set<() => Promise<void>>;
    } = {};

    /**
     * Add a listener to the store
     * @param listener
     */
    public addListener(height: number, listener: () => Promise<void>) {
        // if a re-org takes place past this block then we need to do call the callback
        if (this.listeners[height]) this.listeners[height].add(listener);
        else this.listeners[height] = new Set([listener]);
    }

    /**
     * Remove the supplied listener from the store
     * @param listener
     */
    public removeListener(height: number, listener: () => Promise<void>): boolean {
        const listeners = this.listeners[height];
        // remove the listener from the set
        return (
            (listeners || false) &&
            listeners.delete(listener) &&
            listeners.size === 0 &&
            delete this.listeners[height]
        );
    }

    /**
     * Get all listeners who have a height equal to or the supplied one
     * @param height
     */
    public getListenersFromHeight(height: number) {
        return ([] as Array<() => Promise<void>>).concat(
            ...Object.keys(this.listeners)
                .map(k => Number.parseInt(k))
                .filter(f => f >= height)
                .map(k => Array.from(this.listeners[k]))
        );
    }

    /**
     * Remove all listeners who have a height less than the supplied one
     * @param minHeight
     */
    public prune(minHeight: number) {
        Object.keys(this.listeners)
            .map(k => Number.parseInt(k))
            .filter(r => r < minHeight)
            .forEach(k => delete this.listeners[k]);
    }
}