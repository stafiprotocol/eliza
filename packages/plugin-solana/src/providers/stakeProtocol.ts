import { elizaLogger, IAgentRuntime, Provider } from "@elizaos/core";
import { Connection } from "@solana/web3.js";
import NodeCache from "node-cache";
import { StakePoolsType, StakeProtocolData } from "../types/stake";

// Provider configuration for retry mechanism and caching
const PROVIDER_CONFIG = {
    MAX_RETRIES: 3, // Maximum number of retry attempts for failed requests
    RETRY_DELAY: 2000, // Delay between retries in milliseconds
    CACHE_TTL: 300, // Cache time-to-live in seconds (5 minutes)
};

/**
 * Class responsible for fetching and managing stake pool information
 * Implements caching and retry mechanisms for reliable data fetching
 */
export class StakeProtocolProvider {
    private cache: NodeCache;

    constructor(private connection: Connection) {
        this.cache = new NodeCache({ stdTTL: PROVIDER_CONFIG.CACHE_TTL });
    }

    /**
     * Fetches data from a URL with retry mechanism
     * @param url - The URL to fetch data from
     * @param options - Optional fetch configuration
     * @returns Promise resolving to the parsed JSON response
     */
    private async fetchWithRetry(
        url: string,
        options: RequestInit = {}
    ): Promise<unknown> {
        let lastError: unknown;
        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    elizaLogger.error("HTTP error:", response);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                lastError = error;
                elizaLogger.error("Error fetching data:", error);
                await new Promise((resolve) =>
                    setTimeout(resolve, PROVIDER_CONFIG.RETRY_DELAY)
                );
            }
        }
        throw lastError;
    }

    private async fetchPoolList(
        runtime: IAgentRuntime
    ): Promise<StakePoolsType> {
        const requestBaseUrl =
            runtime.getSetting("STAKE_POOL_REQUEST_BASE_URL") ??
            "http://127.0.0.1:6666";
        const data = (await this.fetchWithRetry(
            `${requestBaseUrl}/api/stake-pool-list`
        )) as StakePoolsType;
        return data;
    }

    /**
     * Fetches comprehensive pool data from all supported protocols
     * Implements caching to avoid frequent API calls
     * @returns Promise<StakeProtocolData> containing pool information and timestamp
     */
    private async fetchPoolData(
        runtime: IAgentRuntime
    ): Promise<StakeProtocolData> {
        const cacheKey = "stake_pool_data";
        const cachedData = this.cache.get<StakeProtocolData>(cacheKey);

        if (cachedData) {
            return cachedData;
        }

        const requestBaseUrl =
            runtime.getSetting("STAKE_POOL_REQUEST_BASE_URL") ??
            "http://127.0.0.1:6666";

        const data = (await this.fetchWithRetry(
            `${requestBaseUrl}/api/stake-pool-info`
        )) as StakeProtocolData;

        this.cache.set(cacheKey, data);
        return data;
    }

    /**
     * Public method to retrieve stake pool information
     * @returns Promise<StakeProtocolData> with current pool data
     */
    async getStakePoolInfo(runtime: IAgentRuntime): Promise<StakeProtocolData> {
        return await this.fetchPoolData(runtime);
    }

    async getStakePoolList(runtime: IAgentRuntime): Promise<StakePoolsType> {
        return await this.fetchPoolList(runtime);
    }
}

/**
 * Provider implementation for stake protocol
 * Exports a singleton instance that can be used to fetch stake pool data
 */
const stakeProtocolProvider: Provider = {
    async get(
        runtime: IAgentRuntime
    ): Promise<StakeProtocolData | string | null> {
        const connection = new Connection(
            "https://api.mainnet-beta.solana.com"
        );
        const provider = new StakeProtocolProvider(connection);
        try {
            return await provider.getStakePoolInfo(runtime);
        } catch (error) {
            elizaLogger.error("Error in stake protocol provider:", error);
            return "Sorry, I couldn't fetch the stake protocol data at the moment.";
        }
    },
};

export { stakeProtocolProvider };
