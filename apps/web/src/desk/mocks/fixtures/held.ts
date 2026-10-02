// Held earnings (network-desk 07.1): what each claimable station has earned into the escrow
// contract, and what's owed but not deposited yet. $214.60 for CRAT and $12.40 for FLDR: $227.00.
import { $ } from "./ids";
import { STATION_IDS } from "./stations";

export interface DbBalance {
  heldMicros: number;
  owedMicros: number;
}

export function seedBalances(): Record<string, DbBalance> {
  return {
    [STATION_IDS.CRAT]: { heldMicros: $(214.6), owedMicros: 0 },
    [STATION_IDS.FLDR]: { heldMicros: $(12.4), owedMicros: 0 },
    [STATION_IDS.LUPE]: { heldMicros: 0, owedMicros: 0 }
  };
}

/** The escrow contract (open question 16: Base; the address is illustration). */
export const ESCROW = {
  address: "0x5ee2c41b7a9d03e8f6a2b1c4d5e6f708192aa41d",
  chain: { name: "Base Sepolia", explorerUrl: "https://sepolia.basescan.org" },
  unclaimedPeriodDays: 1095
};
