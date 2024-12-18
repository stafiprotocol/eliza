import { Content } from "@ai16z/eliza";

export interface StakeParams extends Content {
    poolName: string;
    userAddress: string;
    amountSol: number | string;
}
