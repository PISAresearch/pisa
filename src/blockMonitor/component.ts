import { IBlockStub } from "../dataEntities";
import { BlockProcessor } from "./blockProcessor";

export abstract class StateReducer<TState extends object, TBlock extends IBlockStub> {
    public abstract getInitialState(block: TBlock): TState;
    public abstract reduce(prevState: TState, block: TBlock): TState;
}

// TODO:198: use Map<> instead
export type MappedState<TState extends object> = {
    [id: string]: TState;
};

export class MappedStateReducer<
    TState extends object,
    TBlock extends IBlockStub,
    TMappedType extends { id: string }
> extends StateReducer<MappedState<TState>, TBlock> {
    constructor(
        public getItems: () => TMappedType[],
        public getBaseReducer: (obj: TMappedType) => StateReducer<TState, TBlock>
    ) {
        super();
    }

    public getInitialState(block: TBlock): MappedState<TState> {
        const result: MappedState<TState> = {};
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            result[obj.id] = baseReducer.getInitialState(block);
        }
        return result;
    }
    public reduce(prevState: MappedState<TState>, block: TBlock): MappedState<TState> {
        const result: MappedState<TState> = {};
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            const prevObjState = prevState[obj.id];
            result[obj.id] = prevObjState
                ? baseReducer.reduce(prevObjState, block) // reduce from previous state
                : baseReducer.getInitialState(block); // no previous state
        }
        return result;
    }
}

export abstract class Component<TState extends object, TBlock extends IBlockStub> {
    protected abstract handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState): void;

    protected blockStates = new WeakMap<TBlock, TState>();

    constructor(
        protected readonly blockProcessor: BlockProcessor<TBlock>,
        protected readonly stateReducer: StateReducer<TState, TBlock>
    ) {
        this.processNewHead = this.processNewHead.bind(this);

        // TODO:198: off the event somewhere
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
        let state: TState | null = null;
        for (const block of ancestorsToAdd) {
            const parentBlock = this.blockProcessor.blockCache.getBlockStub(block.parentHash);

            // the previous state is the state of the parent block if available, or the initial state otherwise
            const prevAnchorState = parentBlock
                ? this.blockStates.get(parentBlock)!
                : this.stateReducer.getInitialState(block);

            state = this.stateReducer.reduce(prevAnchorState, block);
            this.blockStates.set(block, state);
        }

        const prevState = prevHead && this.blockStates.get(prevHead)!;

        // TODO:198: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TState
        if (prevHead && prevState && state) this.handleNewStateEvent(prevHead, prevState, head, state);
    }
}

type TriggerAndAction<TState extends object, TBlock extends IBlockStub> = {
    condition: (state: TState, block: TBlock) => boolean;
    action: () => void;
};

export abstract class StandardComponent<TState extends object, TBlock extends IBlockStub> extends Component<
    TState,
    TBlock
> {
    constructor(blockProcessor: BlockProcessor<TBlock>, stateReducer: StateReducer<TState, TBlock>) {
        super(blockProcessor, stateReducer);
    }

    protected abstract getActions(): TriggerAndAction<TState, TBlock>[];

    public handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState) {
        for (const { condition, action } of this.getActions()) {
            if (condition(state, head) && !condition(prevState, prevHead)) {
                action();
            }
        }
    }
}

type TriggerAndActionWithId<TState extends object, TBlock extends IBlockStub> = {
    condition: (state: TState, block: TBlock) => boolean;
    action: (id: string) => void;
};

export abstract class StandardMappedComponent<TState extends object, TBlock extends IBlockStub> extends Component<
    MappedState<TState>,
    TBlock
> {
    constructor(blockProcessor: BlockProcessor<TBlock>, stateReducer: StateReducer<MappedState<TState>, TBlock>) {
        super(blockProcessor, stateReducer);
    }

    protected abstract getActions(): TriggerAndActionWithId<TState, TBlock>[];

    public handleNewStateEvent(
        prevHead: TBlock,
        prevState: MappedState<TState>,
        head: TBlock,
        state: MappedState<TState>
    ) {
        for (const [objId, objState] of Object.entries(state)) {
            for (const { condition, action } of this.getActions()) {
                const prevObjState = prevState[objId] as (TState | undefined);
                if (condition(objState, head) && (!prevObjState || !condition(prevObjState, prevHead))) {
                    action(objId);
                }
            }
        }
    }
}
