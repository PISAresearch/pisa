import { PisaTransactionIdentifier } from "./gasQueue";
import {
    MappedState,
    StateReducer,
    MappedStateReducer,
    Component,
    BlockNumberState,
    BlockNumberReducer
} from "../blockMonitor/component";
import { ReadOnlyBlockCache } from "../blockMonitor";
import { Block } from "../dataEntities";
import { MultiResponder } from "./multiResponder";
import { ResponderBlock } from "../dataEntities/block";

export enum ResponderStateKind {
    Pending = 1,
    Mined = 2
}
export type PendingResponseState = {
    appointmentId: string;
    kind: ResponderStateKind.Pending;
    identifier: PisaTransactionIdentifier;
};
export type MinedResponseState = {
    appointmentId: string;
    kind: ResponderStateKind.Mined;
    identifier: PisaTransactionIdentifier;
    blockMined: number;
    nonce: number;
};
export type ResponderAppointmentAnchorState = PendingResponseState | MinedResponseState;
export type ResponderAnchorState = MappedState<ResponderAppointmentAnchorState> & BlockNumberState;

/**
 * Selects information from blocks that are relevant to generating responses.
 */
export class ResponderAppointmentReducer implements StateReducer<ResponderAppointmentAnchorState, ResponderBlock> {
    public constructor(
        private readonly blockCache: ReadOnlyBlockCache<ResponderBlock>,
        private readonly identifier: PisaTransactionIdentifier,
        private readonly appointmentId: string,
        private readonly address: string
    ) {}

    private txIdentifierInBlock(
        block: ResponderBlock,
        identifier: PisaTransactionIdentifier
    ): { blockNumber: number; nonce: number } | null {
        for (const tx of block.transactions) {
            // a contract creation - cant be of interest
            if (!tx.to) continue;

            // look for matching transactions
            const txIdentifier = new PisaTransactionIdentifier(tx.chainId, tx.data, tx.to, tx.value, tx.gasLimit);
            if (txIdentifier.equals(identifier) && tx.from.toLocaleLowerCase() === this.address.toLocaleLowerCase()) {
                return {
                    blockNumber: tx.blockNumber!,
                    nonce: tx.nonce
                };
            }
        }

        return null;
    }

    private getMinedTransaction(headHash: string, identifier: PisaTransactionIdentifier) {
        for (const block of this.blockCache.ancestry(headHash)) {
            const txInfo = this.txIdentifierInBlock(block, identifier);
            if (txInfo) return txInfo;
        }
        return null;
    }

    public getInitialState(block: ResponderBlock): ResponderAppointmentAnchorState {
        // find out the current state of a queue item by looking through all
        // the blocks in the block cache
        const minedTx = this.getMinedTransaction(block.hash, this.identifier);

        return minedTx
            ? {
                  appointmentId: this.appointmentId,
                  kind: ResponderStateKind.Mined,
                  blockMined: minedTx.blockNumber,
                  identifier: this.identifier,
                  nonce: minedTx.nonce
              }
            : {
                  appointmentId: this.appointmentId,
                  kind: ResponderStateKind.Pending,
                  identifier: this.identifier
              };
    }

    public reduce(prevState: ResponderAppointmentAnchorState, block: ResponderBlock): ResponderAppointmentAnchorState {
        if (prevState.kind === ResponderStateKind.Pending) {
            const transaction = this.txIdentifierInBlock(block, prevState.identifier);
            return transaction
                ? {
                      appointmentId: prevState.appointmentId,
                      identifier: prevState.identifier,
                      blockMined: block.number,
                      nonce: transaction.nonce,
                      kind: ResponderStateKind.Mined
                  }
                : {
                      appointmentId: prevState.appointmentId,
                      kind: ResponderStateKind.Pending,
                      identifier: prevState.identifier
                  };
        } else {
            return prevState;
        }
    }
}

/**
 * Handle the state events related to the multiresponder. Knows how to interpret
 * changes in the responder anchor state, and when to fire side effects.
 */
export class MultiResponderComponent extends Component<ResponderAnchorState, Block> {
    public constructor(
        private readonly responder: MultiResponder,
        blockCache: ReadOnlyBlockCache<Block>,
        private readonly confirmationsRequired: number
    ) {
        super(
            new MappedStateReducer(
                () => [...responder.respondedTransactions.values()],
                item =>
                    new ResponderAppointmentReducer(
                        blockCache,
                        item.queueItem.request.identifier,
                        item.id,
                        responder.address
                    ),
                new BlockNumberReducer()
            )
        );
    }

    private hasResponseBeenMined = (
        appointmentState: ResponderAppointmentAnchorState | undefined
    ): appointmentState is MinedResponseState =>
        appointmentState != undefined && appointmentState.kind === ResponderStateKind.Mined;

    private shouldAppointmentBeRemoved = (
        state: ResponderAnchorState,
        appointmentState: ResponderAppointmentAnchorState | undefined
    ): appointmentState is MinedResponseState =>
        appointmentState != undefined &&
        appointmentState.kind === ResponderStateKind.Mined &&
        state.blockNumber - appointmentState.blockMined > this.confirmationsRequired;

    public async detectChanges(prevState: ResponderAnchorState, state: ResponderAnchorState) {
        // every time the we handle a new head event there could potentially have been
        // a reorg, which in turn may have caused some items to be lost from the pending pool.
        // Therefor we check all of the missing items and re-enqueue them if necessary
        await this.responder.reEnqueueMissingItems(
            [...state.items.values()]
                .filter(appState => appState.kind === ResponderStateKind.Pending)
                .map(q => q.appointmentId)
        );

        for (const appointmentId of state.items.keys()) {
            const prevItem = prevState.items.get(appointmentId);
            const currentItem = state.items.get(appointmentId);

            // if a transaction has been mined we need to inform the responder
            if (!this.hasResponseBeenMined(prevItem) && this.hasResponseBeenMined(currentItem)) {
                await this.responder.txMined(currentItem.identifier, currentItem.nonce);
            }

            // after a certain number of confirmations we can stop tracking a transaction
            if (
                !this.shouldAppointmentBeRemoved(prevState, prevItem) &&
                this.shouldAppointmentBeRemoved(state, currentItem)
            ) {
                this.responder.endResponse(currentItem.appointmentId);
            }
        }
    }
}
