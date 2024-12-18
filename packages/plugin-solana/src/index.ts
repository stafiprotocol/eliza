export * from "./providers/token.ts";
export * from "./providers/wallet.ts";
export * from "./providers/trustScoreProvider.ts";
export * from "./evaluators/trust.ts";

import { Plugin } from "@ai16z/eliza";
import { executeSwap } from "./actions/swap.ts";
import take_order from "./actions/takeOrder";
import pumpfun from "./actions/pumpfun.ts";
import { executeSwapForDAO } from "./actions/swapDao";
import transferToken from "./actions/transfer.ts";
import { WalletProvider, walletProvider } from "./providers/wallet.ts";
import { trustScoreProvider } from "./providers/trustScoreProvider.ts";
import { trustEvaluator } from "./evaluators/trust.ts";
import { TokenProvider } from "./providers/token.ts";
import liquidStake from "./actions/liquidStake.ts";
import { stakeProtocolProvider } from "./providers/stakeProtocol.ts";

export { TokenProvider, WalletProvider };

export const solanaPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin for Eliza",
    actions: [
        executeSwap,
        pumpfun,
        transferToken,
        executeSwapForDAO,
        take_order,
        liquidStake,
    ],
    evaluators: [trustEvaluator],
    providers: [walletProvider, trustScoreProvider, stakeProtocolProvider],
};

export default solanaPlugin;
