import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, ApplicationError } from "../dataEntities";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TAnchorState extends object, TBlock extends IBlockStub> extends EventEmitter {
    public static NEW_STATE_EVENT = "new_state";

    private blockStates = new WeakMap<TBlock, TAnchorState>();

    constructor(
        private blockProcessor: BlockProcessor<TBlock>,
        private initialAnchorState: TAnchorState,
        private reducer: (prevAnchorState: TAnchorState, block: TBlock) => TAnchorState
    ) {
        super();

        this.processNewHead = this.processNewHead.bind(this);

        blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }

    private processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null) {
        // Make the list of ancestors up to (and excluding) prevHead;
        // put all the ancestry if prevHead is null
        const ancestorsToAdd: Readonly<TBlock>[] = [];
        for (const block of this.blockProcessor.blockCache.ancestry(head.hash)) {
            if (prevHead && block.hash === prevHead.hash) break;
            ancestorsToAdd.push(block);
        }

        // start from the oldest, compute each block's state
        ancestorsToAdd.reverse();
        let state: TAnchorState | null = null;
        for (const block of ancestorsToAdd) {
            const parentBlock = this.blockProcessor.blockCache.getBlockStub(block.parentHash);

            // the previous state is the state of the parent block if available, or the initial state otherwise
            const prevAnchorState = parentBlock ? this.blockStates.get(parentBlock)! : this.initialAnchorState;

            state = this.reducer(prevAnchorState, block);
            this.blockStates.set(block, state);
        }

        const prevState = prevHead && this.blockStates.get(prevHead)!;

        // TODO: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TAnchorState
        this.emit(BlockchainMachine.NEW_STATE_EVENT, head, state, prevHead, prevState);
    }
}
