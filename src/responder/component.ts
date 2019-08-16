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
import { Block, ArgumentError } from "../dataEntities";
import { MultiResponder } from "./multiResponder";
import { ResponderBlock } from "../dataEntities/block";
import logger from "../logger";
import { UnreachableCaseError } from "../dataEntities/errors";

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
            if (txIdentifier.equals(identifier) && tx.from.toLowerCase() === this.address.toLowerCase()) {
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

        if (minedTx) {
            return {
                appointmentId: this.appointmentId,
                kind: ResponderStateKind.Mined,
                blockMined: minedTx.blockNumber,
                identifier: this.identifier,
                nonce: minedTx.nonce
            };
        } else {
            return {
                appointmentId: this.appointmentId,
                kind: ResponderStateKind.Pending,
                identifier: this.identifier
            };
        }
    }

    public reduce(prevState: ResponderAppointmentAnchorState, block: ResponderBlock): ResponderAppointmentAnchorState {
        if (prevState.kind === ResponderStateKind.Pending) {
            const transaction = this.txIdentifierInBlock(block, prevState.identifier);
            if (transaction) {
                return {
                    appointmentId: prevState.appointmentId,
                    identifier: prevState.identifier,
                    blockMined: block.number,
                    nonce: transaction.nonce,
                    kind: ResponderStateKind.Mined
                };
            }
        }
        return prevState;
    }
}

export enum ResponderActionKind {
    ReEnqueueMissingItems = 1,
    TxMined = 2,
    EndResponse = 3,
    CheckResponderBalance = 4
}

export type ReEnqueueMissingItemsAction = {
    readonly kind: ResponderActionKind.ReEnqueueMissingItems;
    readonly appointmentIds: string[];
};

export type TxMinedAction = {
    readonly kind: ResponderActionKind.TxMined;
    readonly identifier: PisaTransactionIdentifier;
    readonly nonce: number;
};

export type EndResponseAction = {
    readonly kind: ResponderActionKind.EndResponse;
    readonly appointmentId: string;
};

export type CheckResponderBalanceAction = {
    readonly kind: ResponderActionKind.CheckResponderBalance;
}


export type ResponderAction = TxMinedAction | ReEnqueueMissingItemsAction | EndResponseAction | CheckResponderBalanceAction;

/**
 * Handle the state events related to the multiresponder. Knows how to interpret
 * changes in the responder anchor state, and when to fire side effects.
 */
export class MultiResponderComponent extends Component<ResponderAnchorState, Block, ResponderAction> {
    
    public constructor(
        private readonly responder: MultiResponder,
        blockCache: ReadOnlyBlockCache<Block>,
        private readonly confirmationsRequired: number,
    ) {
        super(
            new MappedStateReducer(
                () => [...responder.transactions.values()],
                item =>
                    new ResponderAppointmentReducer(
                        blockCache,
                        item.request.identifier,
                        item.request.appointment.id,
                        responder.address
                    ),
                item => item.request.appointment.id,
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

    public detectChanges(prevState: ResponderAnchorState, state: ResponderAnchorState): ResponderAction[] {
        const actions: ResponderAction[] = [];

        // every time the we handle a new head event there could potentially have been
        // a reorg, which in turn may have caused some items to be lost from the pending pool.
        // Therefore we check all of the missing items and re-enqueue them if necessary
        const reEnqueItems = [...state.items.values()]
            .filter(appState => appState.kind === ResponderStateKind.Pending)
            .map(q => q.appointmentId);
        if (reEnqueItems.length > 0) {
            actions.push({ kind: ResponderActionKind.ReEnqueueMissingItems, appointmentIds: reEnqueItems });
        }

        for (const [appointmentId, currentItem] of state.items.entries()) {
            const prevItem = prevState.items.get(appointmentId);

            if (!prevItem && currentItem.kind === ResponderStateKind.Pending) {
                logger.info({state: currentItem, id: appointmentId, blockNumber: state.blockNumber }, "New pending transaction.") // prettier-ignore
            }

            // if a transaction has been mined we need to inform the responder and also check the responder balance before responding
            if (!this.hasResponseBeenMined(prevItem) && this.hasResponseBeenMined(currentItem)) {
                logger.info({state: currentItem, id: appointmentId, blockNumber: state.blockNumber }, "Transaction mined.") // prettier-ignore
                actions.push({
                    kind: ResponderActionKind.TxMined,
                    identifier: currentItem.identifier,
                    nonce: currentItem.nonce
                },{
                    kind:ResponderActionKind.CheckResponderBalance,
                });
                
            }   

            // after a certain number of confirmations we can stop tracking a transaction
            if (
                !this.shouldAppointmentBeRemoved(prevState, prevItem) &&
                this.shouldAppointmentBeRemoved(state, currentItem)
            ) {
                logger.info({state: currentItem, id: appointmentId, blockNumber: state.blockNumber }, "Response removed.") // prettier-ignore
                actions.push({
                    kind: ResponderActionKind.EndResponse,
                    appointmentId: currentItem.appointmentId
                });
            }
        }

        return actions;
    }

    public async applyAction(action: ResponderAction) {

        switch (action.kind) {
            case ResponderActionKind.ReEnqueueMissingItems:
                await this.responder.reEnqueueMissingItems(action.appointmentIds);
                break;
            case ResponderActionKind.TxMined:
                await this.responder.txMined(action.identifier, action.nonce);
                break;
            case ResponderActionKind.EndResponse:
                await this.responder.endResponse(action.appointmentId);
                break;
            case ResponderActionKind.CheckResponderBalance:
                await this.responder.checkBalance();
                break;
            default:
                throw new UnreachableCaseError(action, "Unrecognised responder action kind.");
        }
    }
}
