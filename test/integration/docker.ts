import DockerClient from "dockerode";
import logger from "../../src/logger";
import { IArgConfig, ConfigManager } from "../../src/dataEntities/config";
import { FileUtils } from "./fileUtil";
import path from "path";
import fs from "fs";
import { ConfigurationError } from "../../src/dataEntities";
import { Key } from "./keyStore";
import { ChainData } from "./chainData";
import tar from "tar";

interface IPortBinding {
    Host: string;
    Container: string;
}

class DockerImageLib {
    public static PARITY_IMAGE = "parity/parity:v2.5.0";
    public static PISA_IMAGE = "pisaresearch/pisa:0.1.2";
}

class FakeDockerVolume {
    public constructor(public readonly hostLocation: string, public readonly containerUnzipLocation: string) {}
    private archiveLocation: string;
    async createArchive() {
        // zip up the location
        const tarLocation = `${this.hostLocation}.tar`;
        const cwd = path.dirname(this.hostLocation);
        const fileName = path.basename(this.hostLocation);
        await tar.create(
            {
                file: tarLocation,
                cwd: cwd,
                

            },
            [fileName]
        );
        this.archiveLocation = tarLocation;
        return tarLocation;
    }
    deleteArchive() {
        fs.unlinkSync(this.archiveLocation);
    }
}

abstract class DockerContainer {
    constructor(
        protected readonly dockerClient: DockerClient,
        public readonly name: string,
        public readonly imageName: string,
        public readonly commands: string[],
        public readonly volumes: FakeDockerVolume[],
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
            Entrypoint: ["echo", "$UID"],
            //Cmd: this.commands,
            Image: this.imageName,
            Tty: true,
            name: this.name,
            HostConfig: {
                PortBindings: ports,
                NetworkMode: this.network
            }
        });

        await Promise.all(
            this.volumes.map(async v => {
                const path = await v.createArchive();
                const put = await container.putArchive(path, { path: v.containerUnzipLocation });
                v.deleteArchive();
                return put;
            })
        );

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
    constructor(
        dockerClient: DockerClient,
        name: string,
        config: IArgConfig,
        hostPort: number,
        hostLogsDir: string,
        network: string
    ) {
        const configManager = new ConfigManager(ConfigManager.PisaConfigProperties);
        const commandLineArgs = configManager.toCommandLineArgs(config);

        //        const volumes: FakeDockerVolume[] = [new FakeDockerVolume(hostLogsDir, "/usr/pisa/logs")];
        const volumes: FakeDockerVolume[] = [new FakeDockerVolume(hostLogsDir, "/usr/pisa")];

        super(
            dockerClient,
            name,
            DockerImageLib.PISA_IMAGE,
            ["node", "./build/src/startUp.js", ...commandLineArgs],
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
        //const parityLogFile = "./logs/" + name + "/parity.log";
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
            "--usd-per-tx",
            "0"
        ];

        const volumes: FakeDockerVolume[] = [
            new FakeDockerVolume(parityLogFile, "/home/parity"),
            new FakeDockerVolume(chainDataFile, "/home/parity"),
            new FakeDockerVolume(keysDir, "/home/parity"),
            new FakeDockerVolume(passwordFile, "/home/parity")
            // new FakeDockerVolume(parityLogFile, "/home/parity/parity.log"),
            // new FakeDockerVolume(chainDataFile, "/home/parity/chain.json"),
            // new FakeDockerVolume(keysDir, "/home/parity/keys"),
            // new FakeDockerVolume(passwordFile, "/home/parity/passwords")
        ];

        super(
            dockerClient,
            name,
            DockerImageLib.PARITY_IMAGE,
            parityCommand,
            volumes,
            [{ Host: `${hostPort}`, Container: `${jsonRpcPort}/tcp` }],
            network
        );
    }
}
