import { Content, IAgentRuntime, Memory } from "@ai16z/eliza";

export interface StakeParams extends Content {
    poolName: string;
    userAddress: string;
    amountSol: number | string;
}

export interface StakeConfig {
    name: string;
    similes: string[];
    pools: {
        [key: string]: {
            address: string;
            protocolName: string;
        };
    };
    preprocess?: (runtime: IAgentRuntime, message: Memory) => Promise<void>;
}
