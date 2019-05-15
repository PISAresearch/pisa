import "mocha";
import { expect } from "chai";
import DockerClient from "dockerode";
import logger from "../../src/logger";

class DockerManager {
    public static PARITY_IMAGE = "parity/parity:v2.5.0";

    private docker = new DockerClient();

    public async pullImage(imageName: string) {
        logger.info(`Pulling image: ${imageName}.`);

        const stream = await this.docker.pull(imageName, {});

        return new Promise(resolve => {
            this.docker.modem.followProgress(stream, resolve);
        });
    }

    public async startStopService(imageName: string) {
        const container = await this.docker.createContainer({
            Image: imageName,
            Tty: true
        });

        const stream = await container.attach({
            stream: true, stdout: true, stderr: true
        });
        stream.pipe(process.stdout);

        await container.start();
        await container.stop();
        await container.remove();
    }
}

describe("Integration", () => {
    it("End to end", async () => {
        const manager = new DockerManager();
        await manager.pullImage(DockerManager.PARITY_IMAGE);
        await manager.startStopService(DockerManager.PARITY_IMAGE);
    }).timeout(30000);
});
