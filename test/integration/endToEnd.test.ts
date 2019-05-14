// bring up a test environment using docker, or should this be done as part of
// of a one time start up, followed by many tests?

// no bring it up now

// use dockerode to orchestrate this behaviour

// create a wrapper class around dockerode for our needs

// start a parity node
// start pisa, connect it to the node

// execute the test - verify the results - by checking the blockchain

import Docker, { ContainerCreateOptions } from "dockerode";


class ConfigParser {
    
}




class EthereumIntegration {
    private readonly docker = new Docker();

    private readonly PARITY_IMAGE = "parity/parity:v2.5.0";
    private readonly PISA_IMAGE = "pisaresearch/pisa:0.1.2";

    async pullImage(imageName: string) {
        console.log(`pulling image ${imageName}`);
        const stream = await this.docker.pull(imageName, {});
        return new Promise((resolve, reject) => {
            function onFinished(err: any, output: any) {
                resolve();
            }
            this.docker.modem.followProgress(stream, onFinished);
        });
    }

    async createContainer(imageName: string, commands: string[], volumes: string[]) {
        console.log(`creating container for ${imageName}`);

        const containerOptions: ContainerCreateOptions = {
            Image: imageName,
            Tty: true,
            Volumes: {
                //"/usr/pisa/build/src/config.json": ""
                //"./configs/pisa.json": {  }
            },
            HostConfig: {
                Binds: volumes
            },
            Cmd: commands
        };
        return await this.docker.createContainer(containerOptions);
    }

    async runParity() {
        await this.pullImage(this.PARITY_IMAGE);
        const container = await this.createContainer(this.PARITY_IMAGE, [], []);

        const str = await container.attach({
            stream: true,
            stdout: true,
            stderr: true
        });
        str.pipe(process.stdout);

        console.log(`starting container: ${container.id}`);
        await container.start();

        console.log(`stopping container: ${container.id}`);
        await container.stop();

        console.log(`removing container: ${container.id}`);
        await container.remove();
    }

    async runPisa() {
        await this.pullImage(this.PISA_IMAGE);

        const container = await this.createContainer(
            this.PISA_IMAGE,
            ["node", "./build/src/startUp.js", "--host-port", "3001"],
            ["/home/chris/dev/pisa/configs/pisa.json:/usr/pisa/build/src/config.json"]
        );

        const str = await container.attach({
            stream: true,
            stdout: true,
            stderr: true
        });
        str.pipe(process.stdout);

        console.log(`starting container: ${container.id}`);
        await container.start();

        console.log(`stopping container: ${container.id}`);
        await container.stop();

        console.log(`removing container: ${container.id}`);
        await container.remove();
    }
}

const integration = new EthereumIntegration();
integration.runPisa().then(a => console.log(a), err => console.error(err));
