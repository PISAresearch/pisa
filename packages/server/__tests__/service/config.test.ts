import "mocha";
import { expect } from "chai";
import { IArgConfig, ConfigManager, PisaConfigManager } from "../../src/service/config";

describe("ConfigManager", () => {
    it("parses and serialises command line args", () => {
        const config: IArgConfig = {
            dbDir: "pisa-db",
            hostName: "0.0.0.0",
            hostPort: 4567,
            jsonRpcUrl: "http://localhost:8545",
            responderKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
            receiptKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
            pisaContractAddress: "0x3deA9963BF4c1a3716025dE8AE05a5caC66db46E",

            rateLimitGlobalMax: 100,	
            rateLimitGlobalMessage: "Test global message",	
            rateLimitGlobalWindowMs: 60000,	
            rateLimitUserMax: 5,	
            rateLimitUserMessage: "Test user message",	
            rateLimitUserWindowMs: 60000
        };

        const manager = new ConfigManager(PisaConfigManager.PisaConfigProperties);
        const args = manager.toCommandLineArgs(config);
        const parsedConfig = manager.fromCommandLineArgs(args);
        Object.keys(config).forEach(key => {
            expect((parsedConfig as any)[key]).to.equal((config as any)[key]);
        });
    });
});
