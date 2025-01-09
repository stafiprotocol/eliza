import { elizaLogger, settings } from "@elizaos/core";
import { web3 } from "@coral-xyz/anchor";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
} from "@elizaos/core";
import { composeContext } from "@elizaos/core";
import { getWalletKey } from "../keypairUtils";
import { generateObjectDeprecated } from "@elizaos/core";

export interface RestakeContent extends Content {
    amount: string | number;
}

function isRestakeContent(
    runtime: IAgentRuntime,
    content: any
): content is RestakeContent {
    console.log("Content for restake", content);
    return (
        typeof content.amount === "string" || typeof content.amount === "number"
    );
}

/**
 * @param account Pass in the public key of the user that is providing the stake
 * @param amount Define the amount of native SOL (in SOL) that the user will stake
 */
async function getServerSignedTx(account: web3.PublicKey, amount: string) {
    return new Promise(async (resolve, reject) => {
        try {
            // Make a POST request to the Solana actions endpoint
            const response = await fetch(
                `https://app.solayer.org/api/action/restake/ssol?amount=${amount}`,
                {
                    method: "post",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        account: account.toString(),
                    }),
                }
            );
            const res = await response.json();
            if (!response.ok) {
                throw new Error((res as any)?.message || "error");
            }
            resolve(res);
        } catch (e) {
            console.log("!!!!!!!!!!!Error!!!!!!!!!!!!!");
            console.log(e);
            throw new Error(e);
        }
    });
}

const restakeTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "amount": "1000"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested restake:
- Amount to restake

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "RESTAKE",
    similes: ["RESTAKE_SOL"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating restake from user:", message.userId);
        return true;
    },
    description: "Restake sol to solayer",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting RESTAKE handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Compose restake context
        const restakeContext = composeContext({
            state,
            template: restakeTemplate,
        });

        // Generate restake content
        const content = await generateObjectDeprecated({
            runtime,
            context: restakeContext,
            modelClass: ModelClass.LARGE,
        });

        // Validate restake content
        if (!isRestakeContent(runtime, content)) {
            console.error("Invalid content for RESTAKE action.");
            if (callback) {
                callback({
                    text: "Unable to process restake request. Invalid content provided.",
                    content: { error: "Invalid restake content" },
                });
            }
            return false;
        }

        try {
            const { keypair: senderKeypair } = await getWalletKey(
                runtime,
                true
            );

            const connection = new Connection(settings.RPC_URL!);

            const decimals = 9;

            // Adjust amount with decimals
            const adjustedAmount = BigInt(
                Number(content.amount) * Math.pow(10, decimals)
            );
            const balance = await connection.getBalance(
                senderKeypair.publicKey
            );
            if (BigInt(balance) < adjustedAmount) {
                throw Error(`Insufficient balance`);
            }
            console.log(
                `Restaking: ${content.amount} SOL (${adjustedAmount} base units)`
            );

            // Use the getServerSignedTx function to construct the restaking transaction
            const data = await getServerSignedTx(
                senderKeypair.publicKey,
                content.amount.toString()
            );
            const txDataBuffer = Buffer.from(data["transaction"], "base64");
            // Sign the transaction and send it
            let transaction = VersionedTransaction.deserialize(
                Uint8Array.from(txDataBuffer)
            );

            transaction.sign([senderKeypair]);

            // Send transaction
            const signature = await connection.sendTransaction(transaction);

            console.log("Restake successful:", signature);

            if (callback) {
                callback({
                    text: `Successfully restake ${content.amount} SOL to solayer`,
                    content: {
                        success: true,
                        signature,
                        amount: content.amount,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during restake:", error);
            if (callback) {
                callback({
                    text: `Error restake: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Restake 1 SOL to solayer",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "I'll restake 1 SOL now...",
                    action: "RESTAKE",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Successfully restake 1 SOL to solayer",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
