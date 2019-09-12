import { IBlockStub, ApplicationError } from "../dataEntities";

export abstract class Event<T extends Function> {
    protected listeners: T[] = [];
    addListener(listener: T) {
        this.listeners.push(listener);
    }
    removeListener(listener: T) {
        const idx = this.listeners.findIndex(l => l === listener);
        if (idx === -1) throw new ApplicationError("No such listener exists.");

        this.listeners.splice(idx, 1);
    }
}

// A listener that receives a `TBlock` parameter
type BlockListener<TBlock extends IBlockStub> = (block: TBlock) => Promise<void>;

export class BlockEvent<TBlock extends IBlockStub> extends Event<BlockListener<TBlock>> {
    protected listeners: BlockListener<TBlock>[] = [];
    async emit(block: TBlock) {
        for (const listener of this.listeners) {
            await listener(block);
        }
    }
}
