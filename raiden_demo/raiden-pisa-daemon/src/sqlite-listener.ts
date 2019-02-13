// polls the raiden sqlite db for new events looking for balance proofs
import * as sqlite from "sqlite3";
import { IRawBalanceProof } from "./balanceProof";

export interface IBalanceProofRecord {
    identifier: number;
    balance_proof: IRawBalanceProof;
}

export class SqliteListener {
    lastRowId: number;
    sqliteDb: sqlite.Database;

    constructor(
        private pollInterval: number,
        dbFileLocation: string,
        private balanceProofCallback: (bp: IRawBalanceProof) => Promise<void>
    ) {
        this.sqliteDb = new sqlite.Database(dbFileLocation);
        this.lastRowId = 0;
        
    }

    public start() {
        //setInterval(this.tick, this.pollInterval);
        this.tick();
    }

    private tick() {
        this.sqliteDb.serialize((async () => {
            try {
                let results = await this.getBalanceProofsSince(this.lastRowId);

                // process the results synchronously
                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    await this.balanceProofCallback(result.balance_proof);
                    this.lastRowId = result.identifier;
                }
            } catch (doh) {
                console.error(doh);
            }
        }));
    }

    private async getBalanceProofsSince(lastRowId: number): Promise<IBalanceProofRecord[]> {
        return ((await this.promiseAll(`SELECT s.identifier, json_extract(s.data, "$.balance_proof") as balance_proof
                    FROM state_changes s
                    WHERE identifier > ${lastRowId} AND (json_extract(s.data, "$._type") == "raiden.transfer.state_change.ReceiveUnlock")
                    ORDER BY s.identifier asc`)) as any[]).map(bpr => {
            return {
                identifier: bpr.identifier,
                balance_proof: JSON.parse(bpr.balance_proof)
            };
        }) as IBalanceProofRecord[];
    }

    private promiseAll(a: string) {
        return new Promise((resolve, reject) => {
            this.sqliteDb.all(a, (err: any, success: any[]) => {
                if (err) reject(err);
                else resolve(success);
            });
        });
    }
}
