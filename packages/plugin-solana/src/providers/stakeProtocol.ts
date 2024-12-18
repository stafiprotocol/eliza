import { IAgentRuntime, Memory, Provider, State } from "@ai16z/eliza";
import { Connection, PublicKey } from "@solana/web3.js";
import NodeCache from "node-cache";
import { STAKE_POOLS } from "../actions/liquidStake";
import { stakePoolInfo } from "@solana/spl-stake-pool";
import { MarinadeUtils } from "@marinade.finance/marinade-ts-sdk";

// Provider configuration
const PROVIDER_CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    CACHE_TTL: 300, // 5 minutes
};

interface StakePoolInfo {
    apy: number;
    tvl: number;
    protocolName: string;
}

interface StakeProtocolData {
    pools: Record<string, StakePoolInfo>;
    timestamp: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class StakeProtocolProvider {
    private cache: NodeCache;

    constructor(private connection: Connection) {
        this.cache = new NodeCache({ stdTTL: PROVIDER_CONFIG.CACHE_TTL });
    }

    private async fetchWithRetry(
        _runtime: IAgentRuntime,
        url: string,
        options: RequestInit = {}
    ): Promise<any> {
        let lastError: any;
        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                console.log("Fetching data from:", url);
                const response = await fetch(url, options);
                if (!response.ok) {
                    console.error("HTTP error:", response);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                lastError = error;
                console.error("Error fetching data:", error);
                await new Promise((resolve) =>
                    setTimeout(resolve, PROVIDER_CONFIG.RETRY_DELAY)
                );
            }
        }
        throw lastError;
    }

    private async fetchPoolData(
        runtime: IAgentRuntime
    ): Promise<StakeProtocolData> {
        const cacheKey = "stake_pool_data";
        const cachedData = this.cache.get<StakeProtocolData>(cacheKey);

        if (cachedData) {
            return cachedData;
        }

        const pools: Record<string, StakePoolInfo> = {};

        // Fetch data for each pool
        for (const [key, pool] of Object.entries(STAKE_POOLS)) {
            try {
                let apy = 0;
                let tvl = 0;
                if (pool.protocolName === "Marinade") {
                    const apyData = await this.fetchWithRetry(
                        runtime,
                        "https://apy.marinade.finance/marinade"
                    );
                    const tvlData = await this.fetchWithRetry(
                        runtime,
                        "https://api.marinade.finance/tlv"
                    );
                    tvl = tvlData.total_sol;
                    apy = apyData.apy;
                } else {
                    const poolAddr = new PublicKey(pool.address);
                    const poolInfo = await stakePoolInfo(
                        this.connection,
                        poolAddr
                    );
                    tvl = MarinadeUtils.lamportsToSol(poolInfo.totalLamports);
                    await sleep(1000);
                }
                // Add mock data for demonstration
                pools[key] = {
                    apy: apy, // Replace with actual API data
                    tvl: tvl, // Replace with actual API data
                    protocolName: pool.protocolName,
                };
            } catch (error) {
                console.error(
                    `Error fetching data for ${pool.protocolName}:`,
                    error
                );
            }
        }

        const data: StakeProtocolData = {
            pools,
            timestamp: Date.now(),
        };

        this.cache.set(cacheKey, data);
        return data;
    }

    async getFormattedStakeData(runtime: IAgentRuntime): Promise<string> {
        const data = await this.fetchPoolData(runtime);

        let output = "Available Liquid Staking Protocols:\n\n";

        for (const [_key, pool] of Object.entries(data.pools)) {
            output += `${pool.protocolName}:\n`;
            output += `• APY: ${pool.apy.toFixed(2)}%\n`;
            output += `• TVL: $${pool.tvl.toLocaleString()}\n\n`;
        }

        return output;
    }

    async getStakePoolInfo(runtime: IAgentRuntime): Promise<StakeProtocolData> {
        return await this.fetchPoolData(runtime);
    }
}

const stakeProtocolProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string | null> {
        try {
            // todo: endpoint config to .env
            const connection = new Connection(
                "https://api.mainnet-beta.solana.com"
            );
            const provider = new StakeProtocolProvider(connection);
            return await provider.getFormattedStakeData(runtime);
        } catch (error) {
            console.error("Error in stake protocol provider:", error);
            return "Sorry, I couldn't fetch the stake protocol data at the moment.";
        }
    },
};

export { stakeProtocolProvider };
