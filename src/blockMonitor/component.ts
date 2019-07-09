import { IBlockStub } from "../dataEntities";
import { BlockProcessor } from "./blockProcessor";

/**
 * A base for object that define the initial anchor state and the changes in state when a new block is processed.
 */
export interface StateReducer<TState extends object, TBlock extends IBlockStub> {
    getInitialState(block: TBlock): TState;
    reduce(prevState: TState, block: TBlock): TState;
}

export type MappedState<TState extends object> = Map<string, TState>;

/**
 * A utility class to apply a reducer to each object of a set of objects that contains a string `id` field.
 * Each object can be used to generate an individual reducer, and this class combines them to obtain a bigger
 * anchor state as a map indexed by the same `id`.
 */
export class MappedStateReducer<TState extends object, TBlock extends IBlockStub, TMappedType extends { id: string }>
    implements StateReducer<MappedState<TState>, TBlock> {
    /**
     * Creates a new reducer for the given collection of objects.
     * @param getItems a function returning the current state of the collection; it is expected that
     *                 the collection changes over time, but each item of the collection should be immutable.
     * @param getBaseReducer a function that returns a reducer for
     */
    constructor(
        public getItems: () => TMappedType[],
        public getBaseReducer: (obj: TMappedType) => StateReducer<TState, TBlock>
    ) {}

    public getInitialState(block: TBlock): MappedState<TState> {
        const result: MappedState<TState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            result.set(obj.id, baseReducer.getInitialState(block));
        }
        return result;
    }
    public reduce(prevState: MappedState<TState>, block: TBlock): MappedState<TState> {
        const result: MappedState<TState> = new Map();
        for (const obj of this.getItems()) {
            const baseReducer = this.getBaseReducer(obj);
            const prevObjState = prevState.get(obj.id);
            result.set(
                obj.id,
                prevObjState
                    ? baseReducer.reduce(prevObjState, block) // reduce from previous state
                    : baseReducer.getInitialState(block) // no previous state
            );
        }
        return result;
    }
}

export abstract class Component<TState extends object, TBlock extends IBlockStub> {
    public constructor(public readonly reducer: StateReducer<TState, TBlock>) {}
    abstract handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState): void;
}

type TriggerAndActionWithId<TState extends object, TBlock extends IBlockStub> = {
    condition: (state: TState, block: TBlock) => boolean;
    action: (id: string) => void;
};

/**
 * A commodity class that generates a mapped anchor state and generates side effects independently for each mapped item.
 * TODO:198: add more documentation.
 */
export abstract class StandardMappedComponent<TState extends object, TBlock extends IBlockStub> extends Component<
    MappedState<TState>,
    TBlock
> {
    constructor(reducer: StateReducer<MappedState<TState>, TBlock>) {
        super(reducer);
    }

    protected abstract getActions(): TriggerAndActionWithId<TState, TBlock>[];

    public handleNewStateEvent(
        prevHead: TBlock,
        prevState: MappedState<TState>,
        head: TBlock,
        state: MappedState<TState>
    ) {
        for (const [objId, objState] of state.entries()) {
            for (const { condition, action } of this.getActions()) {
                const prevObjState = prevState.get(objId);
                if (condition(objState, head) && (!prevObjState || !condition(prevObjState, prevHead))) {
                    action(objId);
                }
            }
        }
    }
}
