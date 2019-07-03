import { IBlockStub } from "../dataEntities";

export interface Component<TState, TBlock extends IBlockStub> {
    reduce(prevState: TState, block: TBlock): TState;
    handleNewStateEvent(prevHead: TBlock, prevState: TState, head: TBlock, state: TState): void;
}
