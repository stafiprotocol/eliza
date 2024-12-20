import {
    Connection,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { depositSol } from "@solana/spl-stake-pool";
import { StakeConfig, StakeParams } from "../types/stake.ts";
import {
    ActionExample,
    composeContext,
    generateObject,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
} from "@ai16z/eliza";
import bs58 from "bs58";
import {
    Marinade,
    MarinadeConfig,
    MarinadeUtils,
} from "@marinade.finance/marinade-ts-sdk";
import { StakeProtocolProvider } from "../providers/stakeProtocol.ts";

const connection = new Connection("https://api.mainnet-beta.solana.com");

const provider = new StakeProtocolProvider(connection);

export const STAKE_POOLS = {
    jito: {
        address: "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
        protocolName: "Jito",
    },
    blaze: {
        address: "stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi",
        protocolName: "Blaze",
    },
    marginfi: {
        address: "DqhH94PjkZsjAqEze2BEkWhFQJ6EyU6MdtMphMgnXqeK",
        protocolName: "Marginfi",
    },
    jpool: {
        address: "CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1",
        protocolName: "JPool",
    },
    marinade: {
        address: "MckGXZC1GbLqTK1vaSWsjRvWg5G3tj8hpXfaHYBqqKy",
        protocolName: "Marinade",
    },
} as const;

const config: StakeConfig = {
    name: "STAKE_SOL",
    similes: [
        "STAKE_LIQUID_SOL",
        "STAKE_SOL_IN_JITO",
        "STAKE_SOL_IN_BLAZE",
        "STAKE_SOL_IN_MARGINFI",
        "STAKE_SOL_IN_JPOOL",
        "STAKE_SOL_IN_MARINADE",
        "STAKE_BLAZE_SOL",
        "STAKE_MARGINFI_SOL",
        "STAKE_JITO_SOL",
        "STAKE_JPOOL_SOL",
        "STAKE_MARINADE_SOL",
    ],
    pools: STAKE_POOLS,
};

function isStakeParams(content: any): content is StakeParams {
    console.log("Content for stake sol", content);
    return (
        typeof content.userAddress === "string" &&
        (typeof content.amountSol === "number" ||
            typeof content.amountSol === "string")
    );
}

export default {
    name: config.name,
    similes: config.similes,
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        // Check if the required Solana settings are available
        return true;
    },
    description: `Stake SOL in liquid Protocol. This action requires the user to provide the user address, amount of SOL to stake.`,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        console.log("Starting STAKE_SOL handler...");

        if (!state) {
            state = await runtime.composeState(message);
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const stakeContext = composeContext({
            state,
            template: createStakeTemplate,
        });

        const content = await generateObject({
            runtime,
            context: stakeContext,
            modelClass: ModelClass.LARGE,
        });

        if (!isStakeParams(content)) {
            console.error("Invalid content for stake action.");
            if (callback) {
                callback({
                    text: "Unable to process stake request. Invalid content provided.",
                    content: {
                        error: "Invalid stake content",
                    },
                });
            }
            return false;
        }

        const userAddress = content.userAddress;
        const amountSol = parseFloat(content.amountSol as string);

        // Select the best pool based on APY and TVL
        if (content.poolName === "" || content.poolName === null) {
            console.log("Selecting best pool...");

            state.poolData = await provider.getStakePoolInfo(runtime);
            const selectionPoolContext = composeContext({
                state,
                template: selectionPoolTemplate,
            });
            const selectedPoolResp = await generateObject({
                runtime,
                context: selectionPoolContext,
                modelClass: ModelClass.LARGE,
            });
            if (!selectedPoolResp.selectedPool) {
                console.error("Invalid selected pool.");
                if (callback) {
                    callback({
                        text: "Unable to process stake request. Invalid selected pool.",
                        content: {
                            error: "Invalid selected pool",
                        },
                    });
                }
                return false;
            }
            content.poolName = selectedPoolResp.selectedPool;
        }

        const pool = config.pools[content.poolName.toLowerCase()];

        if (!pool) {
            console.error(`Invalid pool name: ${content.poolName}`);
            if (callback) {
                callback({
                    text: `Invalid pool name: ${content.poolName}. Please choose either "jito" or "blaze".`,
                    content: {
                        error: "Invalid pool name",
                    },
                });
            }
            return false;
        }

        console.log(`selected pool: ${pool.address} ${pool.protocolName}`);

        const userPublicKey = new PublicKey(userAddress);

        try {
            const STAKE_POOL = new PublicKey(pool.address);

            let depositResult;

            if (pool.protocolName.toLowerCase() == "marinade") {
                depositResult = await depositSolToMarinade(
                    connection,
                    userPublicKey,
                    amountSol
                );
            } else {
                depositResult = await depositSolToPool(
                    connection,
                    STAKE_POOL,
                    userPublicKey,
                    amountSol
                );
            }

            console.log("Preparing to sign transaction...");

            const serializedTx = depositResult.transaction.serialize();
            const base58Tx = bs58.encode(serializedTx);

            const responseMsg = {
                text: `Stake ${amountSol} SOL in ${pool.protocolName} completed successfully! Transaction: ${base58Tx}`,
            };

            callback?.(responseMsg);

            return true;
        } catch (error) {
            console.error("Error during sol stake:", error);
            if (callback) {
                callback({
                    text: `Error during staking: ${error.message}`,
                    content: {
                        error: error.message,
                    },
                });
            }
            return false;
        }
    },
    examples: createStakeExamples(config),
};

async function depositSolToMarinade(
    connection: Connection,
    from: PublicKey,
    amountSol: number
): Promise<{ transaction: VersionedTransaction; rentFee: number }> {
    const config = new MarinadeConfig({
        connection,
        publicKey: from,
    });
    const marinade = new Marinade(config);

    const { transaction } = await marinade.deposit(
        MarinadeUtils.solToLamports(amountSol)
    );

    const instructions = transaction.instructions;

    const latestBlockhash = await connection.getLatestBlockhash();

    const msg = new TransactionMessage({
        payerKey: from,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
    }).compileToLegacyMessage();

    const txMsg = new VersionedTransaction(msg);

    return {
        transaction: txMsg,
        rentFee: 0,
    };
}

async function depositSolToPool(
    connection: Connection,
    stakePoolAddress: PublicKey,
    from: PublicKey,
    amountSol: number
): Promise<{ transaction: VersionedTransaction; rentFee: number }> {
    const lamports = MarinadeUtils.solToLamports(amountSol);

    const { instructions, signers } = await depositSol(
        connection,
        stakePoolAddress,
        from,
        lamports
    );

    const latestBlockhash = await connection.getLatestBlockhash();

    const msg = new TransactionMessage({
        payerKey: from,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
    }).compileToLegacyMessage();

    const transaction = new VersionedTransaction(msg);

    transaction.sign(signers);

    return {
        transaction,
        rentFee: 0,
    };
}

export function createStakeExamples(config: StakeConfig): ActionExample[][] {
    const examples: ActionExample[][] = [];

    examples.push([
        {
            user: "{{user1}}",
            content: {
                text: "Stake 2 SOL to Jito, my wallet address is: EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
                action: config.name,
            },
        },
        {
            user: "{{user2}}",
            content: {
                text: "Successfully constructed the transaction from stake 2SOL to Jito, with the transaction base58 encoded as 5KtPn3DXXzHkb7VAVHZGwXJQww39ASnrf7YkyJoF2qAGEpBEEGvRHHLnnTG8ZVwKqNHMqScWVGnsQAgfH5pbxEb",
                action: config.name,
            },
        },
    ]);

    // Examples without specific protocol
    examples.push([
        {
            user: "{{user1}}",
            content: {
                text: "Stake 3.5 SOL, my wallet address is: EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
                action: config.name,
            },
        },
        {
            user: "{{user2}}",
            content: {
                text: "The most suitable stake protocol blaze has been selected for you at present, and the base58 code for building the transaction is 5KtPn3DXXzHkb7VAVHZGwXJQww39ASnrf7YkyJoF2qAGEpBEEGvRHHLnnTG8ZVwKqNHMqScWVGnsQAgfH5pbxEb",
                action: config.name,
            },
        },
    ]);

    return examples;
}

export const createStakeTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\\\`json
{
    "userAddress": "HqvTPqS2FaB2fQ7mxqZHQHz6H28o1u2Z9fRH5No8JN2W",
    "amountSol": "1.5",
    "poolName": ""
}
\\\`

{{recentMessages}}

Given the recent messages, extract or come up with (if not explicitly stated) the following information about the requested SOL staking:
- User Address for stake
- Amount of SOL to stake
- Pool name (either "jito" or "blaze" or "jpool" or "marinade" or "marginfi"). It may also be empty

Respond with a JSON markdown block containing only the extracted values.`;

const selectionPoolTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\\\`json
{
    "selectedPool": "jito"
}
\\\`

Given the pool data:
{{poolData}}

Analyze the following factors to select the most suitable SOL staking protocol:
1. APY (Annual Percentage Yield) - Higher is better
2. TVL (Total Value Locked) - Higher indicates more stability and liquidity
3. Protocol reliability and features

Select the best pool from these options: "jito", "blaze", "jpool", "marinade", or "marginfi"

Choose the pool with:
- Highest APY if the difference is significant (>1%)
- If APY differences are minimal (<1%), prefer pools with higher TVL
- Default to "marinade" if data is insufficient or inconclusive

Respond with a JSON markdown block containing only the extracted values.`;
