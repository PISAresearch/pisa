import { IBlockStub } from "../dataEntities";

/**
 * A base for object that define the initial anchor state and the changes in state when a new block is processed.
 */
export interface StateReducer<TState extends object, TBlock extends IBlockStub> {
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
export type MappedState<TState extends object> = {
    items: Map<string, TState>;
};

/**
 * A utility class to apply a reducer to each object of a set of objects that contains a string `id` field.
 * Each object is used to generate an individual reducer (here referred as "base reducer"), and this class combines them
 * to obtain a bigger anchor state as a map indexed by the same `id`.
 */
export class MappedStateReducer<TState extends object, TBlock extends IBlockStub, TMappedType extends { id: string }>
    implements StateReducer<MappedState<TState>, TBlock> {
    /**
     * Creates a new reducer for the given collection of objects.
     * @param getItems a function returning the current state of the collection; it is expected that
     *     the collection changes over time, but each item of the collection should be immutable.
     * @param getBaseReducer a function that returns a reducer for a given object. The function should always
     *     return the same value when called on the same object.
     */
    constructor(
        public readonly getItems: () => Iterable<TMappedType>,
        public readonly getBaseReducer: (obj: TMappedType) => StateReducer<TState, TBlock>
    ) {}

    /**
     * Computes the initial state, by using the `getInitialState` function on each base reducer.
     * @param block
     */
    public getInitialState(block: TBlock): MappedState<TState> {
        const items: Map<string, TState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            items.set(obj.id, baseReducer.getInitialState(block));
        }
        return { items };
    }

    /**
     * Computes the new state; for an object that had a previous state, it uses the `reduce` function on the base reducer.
     * Otherwise, it computes an initial state with `getInitialState` on the base reducer.
     * @param prevState
     * @param block
     */
    public reduce(prevState: MappedState<TState>, block: TBlock): MappedState<TState> {
        const items: Map<string, TState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            const prevObjState = prevState.items.get(obj.id);
            items.set(
                obj.id,
                prevObjState
                    ? baseReducer.reduce(prevObjState, block) // reduce from previous state
                    : baseReducer.getInitialState(block) // no previous state
            );
        }
        return { items };
    }
}

/**
 * A `Component` contains a state reducer and receives and processes the state changes after being added to a `BlockchainMachine`.
 */
export abstract class Component<TState extends object, TBlock extends IBlockStub> {
    constructor(public readonly reducer: StateReducer<TState, TBlock>) {}
    public abstract handleNewStateEvent(prevState: TState, state: TState): void;
}
