import DockerClient from "dockerode";
import { logger } from "../../packages/utils/src";
import { IArgConfig, PisaConfigManager } from "../../packages/server/src/service/config";
import { FileUtils } from "./fileUtil";
import path from "path";
import fs from "fs";
import { ConfigurationError } from "../../packages/errors/src/errors";
import { Key } from "./keyStore";
import { ChainData } from "./chainData";

interface IPortBinding {
    Host: string;
    Container: string;
}

class DockerImageLib {
    public static PARITY_IMAGE = "parity/parity:v2.5.0";
    public static get PISA_IMAGE() {
        return `pisaresearch/pisa:${process.env.TAG_NAME || "master"}`;
    }
}

abstract class DockerContainer {
    constructor(
        protected readonly dockerClient: DockerClient,
        public readonly name: string,
        public readonly imageName: string,
        public readonly commands: string[],
        public readonly volumes: string[],
        public readonly portBindings: IPortBinding[],
        public readonly network?: string
    ) {}
    protected containerId: string;

    private async pullImage(imageName: string) {
        logger.info(`Pulling image: ${imageName}.`);

        const stream = await this.dockerClient.pull(imageName, {});

        return new Promise(resolve => {
            this.dockerClient.modem.followProgress(stream, resolve);
        });
    }

    public async start(attach: boolean): Promise<void> {
        // ensure we have an up to date image
        await this.pullImage(this.imageName);

        const ports: { [containerId: string]: [{ HostPort: string }] } = {};
        this.portBindings.forEach(p => (ports[p.Container] = [{ HostPort: p.Host }]));

        const container = await this.dockerClient.createContainer({
            Cmd: this.commands,
            Image: this.imageName,
            Tty: true,
            name: this.name,
            HostConfig: {
                PortBindings: ports,
                NetworkMode: this.network,
                Binds: this.volumes
            },
            User: "root"
        });

        if (attach) {
            const stream = await container.attach({
                stream: true,
                stdout: true,
                stderr: true
            });
            stream.pipe(process.stdout);
        }

        await container.start();
        this.containerId = container.id;
    }

    public async stop(): Promise<void> {
        if (!this.containerId) return;

        const container = await this.dockerClient.getContainer(this.containerId);
        const inspect = await container.inspect();
        if (inspect.State.Running) await container.stop();
        await container.remove();
    }
}

export class PisaContainer extends DockerContainer {
    constructor(dockerClient: DockerClient, name: string, config: IArgConfig, hostPort: number, hostLogsDir: string, network: string) {
        const configManager = new PisaConfigManager();
        const commandLineArgs = configManager.toCommandLineArgs(config);
        const volumes: string[] = [`${hostLogsDir}:/usr/pisa/logs`];

        super(
            dockerClient,
            name,
            DockerImageLib.PISA_IMAGE,
            ["node", "./dist/startUp.js", ...commandLineArgs],
            volumes,
            [{ Host: `${hostPort}`, Container: `${hostPort}/tcp` }],
            network
        );

        this.config = config;
    }

    public readonly config: IArgConfig;
}

export class ParityContainer extends DockerContainer {
    constructor(
        dockerClient: DockerClient,
        name: string,
        hostPort: number,
        logDir: string,
        network: string,
        logLevel: "error" | "warn" | "info" | "debug" | "trace",
        chainData: ChainData,
        validator: Key,
        accounts: Key[]
    ) {
        // create our own dir inside this one
        const parityDir = path.join(logDir, name);
        if (fs.existsSync(parityDir)) throw new ConfigurationError(`${parityDir} already exists.`);
        fs.mkdirSync(parityDir);

        // we need to create the parity log file as it is mapped as a file volume
        const parityLogFile = path.join(parityDir, "parity.log");
        FileUtils.touchFileSync(parityLogFile);

        // create a keys folder
        const keysDir = path.join(parityDir, "keys");
        fs.mkdirSync(keysDir);
        const chainDir = path.join(keysDir, chainData.name);
        fs.mkdirSync(chainDir);
        [validator].concat(accounts).forEach(v => {
            const keyFile = path.join(chainDir, v.account);
            fs.writeFileSync(keyFile, v.encryptedJson);
        });

        const passwordFile = path.join(parityDir, "pwd");
        fs.writeFileSync(passwordFile, validator.password);

        // write the chain data
        const chainDataFile = path.join(parityDir, "chain.json");
        fs.writeFileSync(chainDataFile, JSON.stringify(chainData.serialise()));

        const jsonRpcPort = "8545";
        const parityCommand = [
            "--jsonrpc-interface",
            "0.0.0.0",
            "--jsonrpc-port",
            jsonRpcPort,
            "--jsonrpc-apis=web3,eth,net,personal,parity,parity_set,traces,rpc,parity_accounts",
            "--log-file",
            "/home/parity/parity.log",
            "--logging",
            logLevel,
            "--chain",
            "/home/parity/chain.json",
            "--keys-path",
            "/home/parity/keys",
            "--password",
            "/home/parity/pwd",
            "--engine-signer",
            validator.account,
            "--reseal-on-txs",
            "none",
            "--reseal-min-period", // to make multiple transaction confirm at the same time
            "0", // see https://github.com/wbwangk/parity-wiki/blob/master/Private-development-chain.md#customizing-the-development-chain
            "--usd-per-tx",
            "0"
        ];

        const volumes: string[] = [
            `${parityLogFile}:/home/parity/parity.log`,
            `${chainDataFile}:/home/parity/chain.json`,
            `${keysDir}:/home/parity/keys`,
            `${passwordFile}:/home/parity/pwd`
        ];

        super(dockerClient, name, DockerImageLib.PARITY_IMAGE, parityCommand, volumes, [{ Host: `${hostPort}`, Container: `${jsonRpcPort}/tcp` }], network);
    }
}
