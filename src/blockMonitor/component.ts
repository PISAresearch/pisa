import { IBlockStub } from "../dataEntities";

<<<<<<< HEAD
export interface Component<TState, Block extends IBlockStub> {
    reduce(prevState: TState, block: Block): TState;
    handleNewStateEvent(prevHead: Block, prevState: TState, head: Block, state: TState): void;
=======
export abstract class Component<TState, TBlock extends IBlockStub> {
    public abstract reduce(prevState: TState, block: TBlock): TState;
    public abstract handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState): void;
>>>>>>> 198-watcher-rewrite
}
