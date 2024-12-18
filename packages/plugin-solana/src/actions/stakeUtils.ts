import {
    Connection,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { depositSol } from "@solana/spl-stake-pool";
import { StakeParams } from "../types/stake.ts";
import {
    type Action,
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
import { STAKE_POOLS } from "./liquidStake";
import { StakeProtocolProvider } from "../providers/stakeProtocol.ts";

function isStakeParams(content: any): content is StakeParams {
    console.log("Content for stake sol", content);
    return (
        typeof content.userAddress === "string" &&
        (typeof content.amountSol === "number" ||
            typeof content.amountSol === "string")
    );
}

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

interface StakeConfig {
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

export function createStakeExamples(actionName: string): ActionExample[][] {
    const examples: ActionExample[][] = [];
    const poolEntries = Object.entries(STAKE_POOLS);

    // Examples with specific protocol
    poolEntries.forEach(([poolName, poolInfo], index) => {
        examples.push([
            {
                user: "{{user1}}",
                content: {
                    text: `I want to stake some SOL in ${poolInfo.protocolName}. Let's say my address is ${poolInfo.address} and I want to stake ${(index + 2).toFixed(1)} SOL.`,
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `Staking ${(index + 2).toFixed(1)} SOL in ${poolInfo.protocolName} pool for address ${poolInfo.address}.`,
                    action: actionName,
                    content: {
                        stakeInfo: {
                            userAddress: poolInfo.address,
                            amountSol: (index + 2).toFixed(1),
                            poolName: poolName,
                        },
                    },
                },
            },
        ]);
    });

    // Examples without specific protocol
    examples.push([
        {
            user: "{{user1}}",
            content: {
                text: `I want to stake 2.5 SOL. My address is ${poolEntries[0][1].address}.`,
            },
        },
        {
            user: "{{user2}}",
            content: {
                text: `Staking 2.5 SOL for address ${poolEntries[0][1].address}.`,
                action: actionName,
                content: {
                    stakeInfo: {
                        userAddress: poolEntries[0][1].address,
                        amountSol: "2.5",
                        poolName: "",
                    },
                },
            },
        },
    ]);

    examples.push([
        {
            user: "{{user1}}",
            content: {
                text: `Could you stake 3 SOL for me? My address is ${poolEntries[0][1].address}.`,
            },
        },
        {
            user: "{{user2}}",
            content: {
                text: `Staking 3 SOL for address ${poolEntries[0][1].address}.`,
                action: actionName,
                content: {
                    stakeInfo: {
                        userAddress: poolEntries[0][1].address,
                        amountSol: "3",
                        poolName: "",
                    },
                },
            },
        },
    ]);

    return examples;
}

export function createStakeTemplate(): string {
    return `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

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
- Pool name (either "jito" or "blaze" or "jpool" or "marinade" or "marginfi")

Respond with a JSON markdown block containing only the extracted values.`;
}

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

export function createStakeAction(config: StakeConfig): Action {
    const stakeTemplate = createStakeTemplate();

    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const provider = new StakeProtocolProvider(connection);

    return {
        name: config.name,
        similes: config.similes,
        validate: async (_runtime: IAgentRuntime, _message: Memory) => {
            // Check if the required Solana settings are available
            return true;
        },
        description: `Stake SOL in liquid Protocol. This action requires the user to provide the user address, amount of SOL to stake, and which pool to stake in.`,
        handler: async (
            runtime: IAgentRuntime,
            message: Memory,
            state: State,
            _options: { [key: string]: unknown },
            callback?: HandlerCallback
        ): Promise<boolean> => {
            console.log("Starting STAKE_LIQUID_SOL handler...");

            if (!state) {
                state = await runtime.composeState(message);
            } else {
                state = await runtime.updateRecentMessageState(state);
            }

            const stakeContext = composeContext({
                state,
                template: stakeTemplate,
            });

            const content = await generateObject({
                runtime,
                context: stakeContext,
                modelClass: ModelClass.SMALL,
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
            if (content.poolName == "") {
                state.poolData = await provider.getStakePoolInfo(runtime);

                const selectionPoolContext = composeContext({
                    state,
                    template: selectionPoolTemplate,
                });

                const selectedPoolResp = await generateObject({
                    runtime,
                    context: selectionPoolContext,
                    modelClass: ModelClass.MEDIUM,
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

            console.log("request userAddress:", userAddress);
            console.log("request amount:", amountSol);
            console.log("request pool:", pool.protocolName);

            const userPublicKey = new PublicKey(userAddress);
            console.log("User Public Key:", userPublicKey);

            try {
                const STAKE_POOL = new PublicKey(pool[1].address);

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
                    text: `Stake ${amountSol} SOL in ${pool[1].protocolName} completed successfully! Transaction: ${base58Tx}`,
                };

                callback?.(responseMsg);

                return true;
            } catch (error) {
                console.error("Error during token swap:", error);
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
        examples: createStakeExamples(config.name),
    } as Action;
}
