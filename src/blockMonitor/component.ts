import { IBlockStub } from "../dataEntities";

/**
 * Anchor state is derived from new blocks. If the block an anchor state is associated
 * with is reverted, then so is the anchor state
 */
export interface AnchorState {
    // although an empty interface provides no type safety, it does help to provide
    // some semantic meaning when using this type as a generic constraint
}

/**
 * A base for object that define the initial anchor state and the changes in state when a new block is processed.
 */
export interface StateReducer<TState extends AnchorState, TBlock extends IBlockStub> {
    /**
     *
     * @param block
     */
    getInitialState(block: TBlock): TState;
    reduce(prevState: TState, block: TBlock): TState;
}

/**
 * Convenience type for a state derived from mapping strings (typically, an id) to a per-item state.
 */
export type MappedState<TState extends AnchorState> = {
    items: Map<string, TState>;
};

/**
 * A utility class to apply a reducer to each object of a set of objects that contains a string `id` field.
 * Each object is used to generate an individual reducer (here referred as "base reducer"), and this class combines them
 * to obtain a bigger anchor state as a map indexed by the same `id`.
 */
export class MappedStateReducer<
    TState extends AnchorState,
    TMappedState extends AnchorState,
    TBlock extends IBlockStub,
    TMappedType extends AnchorState
> implements StateReducer<MappedState<TMappedState>, TBlock> {
    /**
     * Creates a new reducer for the given collection of objects.
     * @param getItems a function returning the current state of the collection; it is expected that
     *      the collection changes over time, but each item of the collection should be immutable.
     * @param getBaseReducer a function that returns a reducer for a given object. The function should always
     *      return the same value when called on the same object. Will be used to reduce each of the objects
     *      in the collection
     * @param reducer The reducer to be used on the whole state.
     */
    constructor(
        public readonly getItems: () => Iterable<TMappedType>,
        public readonly getBaseReducer: (obj: TMappedType) => StateReducer<TMappedState, TBlock>,
        public readonly idSelector: (obj: TMappedType) => string,
        public readonly reducer: StateReducer<TState, TBlock>
    ) {}

    /**
     * Computes the initial state, by using the `getInitialState` function on each base reducer.
     * @param block
     */
    public getInitialState(block: TBlock): MappedState<TMappedState> & TState {
        const items: Map<string, TMappedState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            const id = this.idSelector(obj);
            items.set(id, baseReducer.getInitialState(block));
        }
        const state = this.reducer.getInitialState(block);

        return { items, ...state };
    }

    /**
     * Computes the new state; for an object that had a previous state, it uses the `reduce` function on the base reducer.
     * Otherwise, it computes an initial state with `getInitialState` on the base reducer.
     * @param prevState
     * @param block
     */
    public reduce(prevState: MappedState<TMappedState> & TState, block: TBlock): MappedState<TMappedState> & TState {
        const items: Map<string, TMappedState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            const id = this.idSelector(obj);
            const prevObjState = prevState.items.get(id);
            items.set(
                id,
                prevObjState
                    ? baseReducer.reduce(prevObjState, block) // reduce from previous state
                    : baseReducer.getInitialState(block) // no previous state
            );
        }
        const state = this.reducer.reduce(prevState, block);
        return { items, ...state };
    }
}

/**
 * An action that needs to be taken within a component
 */
export interface ComponentAction {
    // Although this is empty its useful to ascribe some semantic meaning to the generic type
    // that we need in the component
}

/**
 * A `Component` contains a state reducer and receives and processes the state changes after being added to a `BlockchainMachine`.
 */
export abstract class Component<
    TState extends AnchorState,
    TBlock extends IBlockStub,
    TAction extends ComponentAction
> {
    constructor(public readonly reducer: StateReducer<TState, TBlock>) {}
    /**
     * Triggers side effects specified by the actions
     * All side-effect must be thread safe so that they can be applied concurrently
     * @param prevState
     * @param state
     */
    public abstract async applyAction(actions: TAction): Promise<void>;

    /**
     * Detects changes between the previous and current state, and specifies any changes that need
     * to be applied as a result
     * @param prevState
     * @param state
     */
    public abstract detectChanges(prevState: TState, state: TState): TAction[];
}

export interface BlockNumberState {
    blockNumber: number;
}

/**
 * Selects the block number from the provided block
 */
export class BlockNumberReducer implements StateReducer<BlockNumberState, IBlockStub> {
    public getInitialState(block: IBlockStub) {
        return {
            blockNumber: block.number
        };
    }

    public reduce(prevState: BlockNumberState, block: IBlockStub) {
        return {
            blockNumber: block.number
        };
    }
}
