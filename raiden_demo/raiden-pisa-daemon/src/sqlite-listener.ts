// polls the raiden sqlite db for new events looking for balance proofs
import { copyFile } from 'fs';
import * as sqlite from "sqlite3";
import { IRawBalanceProof } from "./balanceProof";

export interface IBalanceProofRecord {
    identifier: number;
    balance_proof: IRawBalanceProof;
}

export class SqliteListener {
    private lastRowId: number;

    constructor(
        private pollInterval: number,
        private dbFileLocation: string,
        startingRowId: number,
        private balanceProofCallback: (bp: IRawBalanceProof) => Promise<void>
    ) {
        this.lastRowId = startingRowId;
    }

    // Makes a local copy of the database, and opens it.
    // Ugly hack needed when running the daemon and raiden within docker containers,
    // where attempts to access the db would return "SQLITE_BUSY" errors.
    private async getDbCopy(): Promise<sqlite.Database> {
        await new Promise((resolve, reject) => {
            console.log(`Making a copy of ${this.dbFileLocation}`);
            copyFile(this.dbFileLocation, 'dbcopy.db', (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
        return new sqlite.Database('dbcopy.db', sqlite.OPEN_READONLY);
    }

    public async start() {
        if (this.lastRowId === null) {
            const sqliteDb = await this.getDbCopy();
            // Find the current lastRowId, then start polling
            this.lastRowId = await new Promise((resolve, reject) => {
                sqliteDb.get("SELECT MAX(s.identifier) as lastRowId FROM state_changes s", [], (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result.lastRowId);
                    }
                });
            });

            sqliteDb.close();
        }

        setInterval(this.tick, this.pollInterval, this);
    }

    private async tick(listener: SqliteListener) {
        const sqliteDb = await listener.getDbCopy();

        sqliteDb.serialize((async () => {
            try {
                console.log("polling for updates")
                let results = await SqliteListener.getBalanceProofsSince(listener.lastRowId, sqliteDb);

                // process the results synchronously
                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    await listener.balanceProofCallback(result.balance_proof);
                    console.log(`Current row id ${result.identifier}`)
                    listener.lastRowId = result.identifier;
                }
            } catch (err) {
                console.error(err);
            }

            sqliteDb.close();
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
