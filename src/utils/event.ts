import { IBlockStub, ApplicationError } from "../dataEntities";

/**
 * This is a generic class to use as base for concrete classes to manage events and event listeners.
 * The type parmeter TListener is the type of the event listeners, which should be a function returning a Promise.
 * Concrete subclasses must implement an `emit` method method to actually emits the event and calls all the listeners,
 * awaiting each one of them.
 */
export abstract class Event<TListener extends Function> {
    protected listeners: TListener[] = [];

    /**
     * Adds `listener` to the list of listeners of the event.
     */
    public addListener(listener: TListener) {
        this.listeners.push(listener);
    }
    /**
     * Remove `listener` from the list of listeners of this event.
     * @throws ApplicationError if `listener` is not among the listeners (either was not added, or was already removed).
     */
    public removeListener(listener: TListener) {
        const idx = this.listeners.findIndex(l => l === listener);
        if (idx === -1) throw new ApplicationError("No such listener exists.");

        this.listeners.splice(idx, 1);
    }
}

// A listener that receives a `TBlock` parameter
type BlockListener<TBlock extends IBlockStub> = (block: TBlock) => Promise<void>;

/**
 * An `Event` that emits a block of type `TBlock`.
 */
export class BlockEvent<TBlock extends IBlockStub> extends Event<BlockListener<TBlock>> {
    protected listeners: BlockListener<TBlock>[] = [];
    public async emit(block: TBlock) {
        for (const listener of this.listeners) {
            await listener(block);
        }
    }
}
