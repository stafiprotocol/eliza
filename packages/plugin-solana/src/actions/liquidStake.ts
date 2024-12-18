import { createStakeAction } from "./stakeUtils";

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

export default createStakeAction({
    name: "STAKE_LIQUID_SOL",
    similes: [
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
});
