// polls the raiden sqlite db for new events looking for balance proofs
import * as sqlite from "sqlite3";
import { IRawBalanceProof } from "./balanceProof";

export interface IBalanceProofRecord {
    identifier: number;
    balance_proof: IRawBalanceProof;
}

export class SqliteListener {
    private lastRowId: number;
    private readonly sqliteDb: sqlite.Database;

    constructor(
        private pollInterval: number,
        dbFileLocation: string,
        startingRowId: number,
        private balanceProofCallback: (bp: IRawBalanceProof) => Promise<void>
    ) {
        this.sqliteDb = new sqlite.Database(dbFileLocation);
        this.lastRowId = startingRowId;
    }

    public async start() {
        if (this.lastRowId === null) {
            // Find the current lastRowId, then start polling
            this.lastRowId = await new Promise((resolve, reject) => {
                this.sqliteDb.get("SELECT MAX(s.identifier) as lastRowId FROM state_changes s", [], (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result.lastRowId);
                    }
                });
            });
        }

        setInterval(this.tick, this.pollInterval, this);
    }

    private tick(listener: SqliteListener) {
        listener.sqliteDb.serialize((async () => {
            try {
                console.log("polling for updates")
                let results = await SqliteListener.getBalanceProofsSince(listener.lastRowId, listener.sqliteDb);

                // process the results synchronously
                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    await listener.balanceProofCallback(result.balance_proof);
                    console.log("ROW ID", listener.lastRowId)
                    console.log("ROW ID", result.identifier)
                    listener.lastRowId = result.identifier;
                }
            } catch (err) {
                console.error(err);
            }
        }));
    }

    private static async getBalanceProofsSince(lastRowId: number, sqliteDb: sqlite.Database): Promise<IBalanceProofRecord[]> {
        return ((await SqliteListener.promiseAll(sqliteDb, `SELECT s.identifier, json_extract(s.data, "$.balance_proof") as balance_proof
                    FROM state_changes s
                    WHERE identifier > ${lastRowId} AND (json_extract(s.data, "$._type") == "raiden.transfer.state_change.ReceiveUnlock")
                    ORDER BY s.identifier asc`)) as any[]).map(bpr => {
            const balanceProofRaw : IRawBalanceProof = JSON.parse(bpr.balance_proof)
            balanceProofRaw.channel_identifier = Number.parseInt((balanceProofRaw.channel_identifier as any), 10);
            balanceProofRaw.nonce = Number.parseInt((balanceProofRaw.nonce as any), 10);
            balanceProofRaw.chain_id = Number.parseInt((balanceProofRaw.chain_id as any), 10);

            return {
                identifier: bpr.identifier,
                balance_proof: balanceProofRaw
            };
        }) as IBalanceProofRecord[];
    }

    private static promiseAll(sqliteDb: sqlite.Database, a: string) {
        return new Promise((resolve, reject) => {
            sqliteDb.all(a, (err: any, success: any[]) => {
                if (err) reject(err);
                else resolve(success);
            });
        });
    }
}
