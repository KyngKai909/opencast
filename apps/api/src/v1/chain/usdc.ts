// Reads USDC transfers on the configured chain (Base; anvil locally): how a transfer from a
// person's linked Clear wallet into a business's balance account is checked before the ledger
// credits it. Read-only; it never sends anything.

import { createPublicClient, getAddress, http, isAddressEqual, parseEventLogs, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import type { TransferCheck } from "../payments/types.js";
import { erc20Abi } from "./abis.js";

export interface UsdcTransfers {
  readonly chainId: number;
  readonly usdc: Address;
  /** Whether `txHash` moved at least `minUnits` of USDC from `from` to `to`. Pending until it's mined. */
  check(input: { txHash: Hex; from: string; to: string; minUnits: bigint }): Promise<TransferCheck>;
}

export function usdcTransfers(config: { rpcUrl: string; usdc: Address; chainId: number }): UsdcTransfers {
  const pub: PublicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const usdc = getAddress(config.usdc);
  return {
    chainId: config.chainId,
    usdc,
    async check({ txHash, from, to, minUnits }) {
      let receipt;
      try {
        receipt = await pub.getTransactionReceipt({ hash: txHash });
      } catch (error) {
        // Not mined yet (or not seen by this node yet).
        if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" };
        throw error;
      }
      if (receipt.status !== "success") return { status: "failed", reason: "That transaction didn't go through on chain." };
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter((log) => isAddressEqual(log.address, usdc));
      let sent = 0n;
      for (const log of transfers) {
        const args = log.args as { from: Address; to: Address; value: bigint };
        if (isAddressEqual(args.from, from as Address) && isAddressEqual(args.to, to as Address)) sent += args.value;
      }
      if (sent === 0n) return { status: "failed", reason: "That transaction didn't send USDC from your Clear wallet to this business's account." };
      if (sent < minUnits) return { status: "failed", reason: "That transaction sent less than the amount." };
      return { status: "confirmed" };
    }
  };
}

/** Needs CHAIN_RPC_URL, CHAIN_ID and USDC_ADDRESS (the escrow contract isn't needed for this). */
export function usdcFromEnv(env: NodeJS.ProcessEnv): UsdcTransfers | null {
  const { CHAIN_RPC_URL, CHAIN_ID, USDC_ADDRESS } = env;
  if (!CHAIN_RPC_URL || !CHAIN_ID || !USDC_ADDRESS) return null;
  return usdcTransfers({ rpcUrl: CHAIN_RPC_URL, usdc: USDC_ADDRESS as Address, chainId: Number(CHAIN_ID) });
}
