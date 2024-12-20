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
                    apy = apyData.apy * 100;
                } else {
                    const poolAddr = new PublicKey(pool.address);
                    const poolInfo = await stakePoolInfo(
                        this.connection,
                        poolAddr
                    );
                    tvl = MarinadeUtils.lamportsToSol(poolInfo.totalLamports);
                    switch (pool.protocolName.toLowerCase()) {
                        case "jito": {
                            const apyData = await this.fetchWithRetry(
                                runtime,
                                "https://www.jito.network/api/getJitoPoolStatsRecentOnly"
                            );
                            apy = apyData.latestApy;
                            break;
                        }
                        case "blaze": {
                            const apyData = await this.fetchWithRetry(
                                runtime,
                                "https://stake.solblaze.org/api/v1/apy"
                            );
                            apy = apyData.apy;
                            break;
                        }
                        case "marginfi": {
                            const apyData = await this.fetchWithRetry(
                                runtime,
                                "https://app.marginfi.com/api/lst"
                            );
                            apy = apyData.data.apy;
                            break;
                        }
                        case "jpool": {
                            const baseData = await this.fetchWithRetry(
                                runtime,
                                "https://stake.solblaze.org/api/v1/apy"
                            );
                            const jpoolData = await this.fetchWithRetry(
                                runtime,
                                "https://api2.jpool.one/direct-stake/strategy/stats?strategy=20&build=0.2.55"
                            );
                            apy = baseData.base + jpoolData.apy;
                            break;
                        }
                        default: {
                            console.error(
                                `Unsupported protocol: ${pool.protocolName}`
                            );
                            break;
                        }
                    }
                    await sleep(1500);
                }
                // Add mock data for demonstration
                console.log(
                    `Fetched data for ${pool.protocolName}: APY: ${apy}, TVL: ${tvl}`
                );
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

    async getStakePoolInfo(runtime: IAgentRuntime): Promise<StakeProtocolData> {
        return await this.fetchPoolData(runtime);
    }
}

const stakeProtocolProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<StakeProtocolData | string | null> {
        try {
            const connection = new Connection(
                "https://api.mainnet-beta.solana.com"
            );
            const provider = new StakeProtocolProvider(connection);
            return await provider.getStakePoolInfo(runtime);
        } catch (error) {
            console.error("Error in stake protocol provider:", error);
            return "Sorry, I couldn't fetch the stake protocol data at the moment.";
        }
    },
};

export { stakeProtocolProvider };
