import { IBlockStub } from "../dataEntities";

export interface Component<TState, Block extends IBlockStub> {
    reduce(prevState: TState, block: Block): TState;
    handleNewStateEvent(prevHead: Block, prevState: TState, head: Block, state: TState): void;
}
