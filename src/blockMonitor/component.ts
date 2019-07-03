import { IBlockStub } from "../dataEntities";

export abstract class Component<TState, TBlock extends IBlockStub> {
    public abstract reduce(prevState: TState, block: TBlock): TState;
    public abstract handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState): void;
}
