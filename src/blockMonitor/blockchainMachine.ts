import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "../dataEntities";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TAnchorState extends object> extends EventEmitter {
    public static NEW_STATE_EVENT = "new_state";

    private blockStates = new WeakMap<IBlockStub, TAnchorState>();
    private mHeadState: TAnchorState | null = null;

    public get headState() {
        return this.mHeadState;
    }

    constructor(
        private blockProcessor: BlockProcessor<IBlockStub>,
        private initialAnchorState: TAnchorState,
        private reducer: (prevAnchorState: TAnchorState, block: IBlockStub) => TAnchorState
    ) {
        super();

        this.processNewHead = this.processNewHead.bind(this);

        blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }

    private processNewHead(head: Readonly<IBlockStub>, prevHead: Readonly<IBlockStub> | null) {
        // Make the list of ancestors up to (and excluding) prevHead;
        // put all the ancestry if prevHead is null
        const ancestorsToAdd: Readonly<IBlockStub>[] = [];
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

            const newState = this.reducer(prevAnchorState, block);
            this.blockStates.set(block, newState);
        }

        const oldState = this.headState;
        this.mHeadState = state;

        // TODO: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TAnchorState
        this.emit(BlockchainMachine.NEW_STATE_EVENT, oldState, state);
    }
}
