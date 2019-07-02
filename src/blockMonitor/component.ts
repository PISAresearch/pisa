import { IBlockStub } from "../dataEntities";

export abstract class Component<TState, Block extends IBlockStub> {
    public abstract reduce(prevState: TState, block: Block): TState;
    public abstract handleNewStateEvent(prevHead: Block, prevState: TState, head: Block, state: TState): void;
}
