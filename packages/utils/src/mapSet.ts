import { ArgumentError } from "@pisa-research/errors";

/**
 * A mapping where the value is a set. Adds some useful helper methods for adding/removing items from the value sets
 */
export class MapOfSets<T1, T2> extends Map<T1, Set<T2>> {
    /**
     * Adds an item to the set value with the supplied key.
     * @param key 
     * @param item 
     */
    public addToSet(key: T1, item: T2) {
        const values = this.get(key);
        if (values == undefined) this.set(key, new Set([item]));
        else values.add(item);
        return this;
    }

    /**
     * Deletes an item from the set value with the supplied key. If after deleting the set contains no values the 
     * key entry is also deleted. Throws an error if the key does not exist.
     * @param key 
     * @param item 
     */
    public deleteFromSet(key: T1, item: T2) {
        const set = this.get(key);
        if (set == undefined) throw new ArgumentError(`No set exists for key ${key}, cannot delete item.`, item);
        const result = set.delete(item);
        // if the set is now empty, we should delete the entry completely
        if(set.size === 0) this.delete(key);
        return result;
    }
}
