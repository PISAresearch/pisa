import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "../dataEntities";
import { Component } from "./component";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TAnchorState extends object, TBlock extends IBlockStub> {
    private blockStates = new WeakMap<TBlock, TAnchorState>();

    constructor(
        private blockProcessor: BlockProcessor<TBlock>,
        private initialAnchorState: TAnchorState,
        private component: Component<TAnchorState, TBlock>
    ) {
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

            state = this.component.reduce(prevAnchorState, block);
            this.blockStates.set(block, state);
        }

        const prevState = prevHead && this.blockStates.get(prevHead)!;

        // TODO: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TAnchorState
        if (prevHead && prevState && state) this.component.handleNewStateEvent(prevHead, prevState, head, state);
    }
}
