import { ethers } from "ethers";
import { JsonRpcProvider } from "ethers/providers";

class ReorgDetector {
    // detects reorgs, allows subscribtion to the reorg event
    constructor(jsonRpcLocation: string, private readonly maxDepth: number) {
        // TODO: async is a real problem here + do we need more info eg. chain id
        this.provider = new JsonRpcProvider(jsonRpcLocation);
        this.provider.on("block", this.extendChain);
    }

    private readonly  provider: ethers.providers.BaseProvider;

    headHash: string;
    parentOf: {
        [hash: string]: string;
    } = {};
    heightByHash: {
        [hash: string]: number;
    } = {};
    hashByheight: {
        [height: number]: string;
    } = {};

    private async getBlockAndCheckAncestor(hash: string) {
        const block = await this.provider.getBlock(hash);

        if (this.parentOf[block.parentHash]) {
            return this.parentOf[block.parentHash];
        } else {
            return await this.getBlockAndCheckAncestor(block.parentHash);
        }
    }

    private resetToRoot(hash: string)  {
        // find the height
        const height = this.heightByHash[hash];

        // remove everything above this height
        const hashesAbove = hash

        // set the head
        this.headHash = hash;

        // reset this provider
        this.provider.resetEventsBlock(height);
    };

    private async extendChain(blockNumber) {
        // get the full block info
        const block = await this.provider.getBlock(blockNumber);

        if (block.parentHash === this.headHash) {
            // great we're extending the chain
            this.headHash = block.hash;

            // TODO: also push to parent of an block by height

            // no re-org -just a new block
        } else {
            // is this parent block in our hash chain?
            let commonAncestor;
            if (this.parentOf[block.hash]) {
                // reorg depth 1
                commonAncestor = this.parentOf[block.hash];
            } else if (this.parentOf[block.parentHash]) {
                // reorg depth 2
                // we can save an rpc call by just checking the common ancestor of the parent
                commonAncestor = this.parentOf[block.parentHash];
            } else {
                // reorg rest
                commonAncestor = await this.getBlockAndCheckAncestor(block.parentHash);
            }

            // notify subscibers - reset local root

            // re-org event

            this.resetToRoot(commonAncestor);
        }

        // subribe to the block - each time we get a new one check it's lineage
    }
}
