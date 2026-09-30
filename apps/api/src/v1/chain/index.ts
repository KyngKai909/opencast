// The escrow contract and the creator fund, on Base (anvil locally). Opencast's settlement wallet
// sends the weekly deposit batch and the pool's fund share; everything else on-chain (verifiers'
// approvals, claims paid, releases to the fund, grants) is done by other keys and read back here
// as events, so the ledger and the claim records follow the chain.

import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbiItem, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { creatorEscrowAbi, creatorFundAbi, erc20Abi } from "./abis.js";

export type ClaimKind = "claim" | "stop";

export type EscrowEvent =
  | { type: "deposited"; escrowId: number; amountMicros: number; forwardedTo: Address | null; tx: Hex; logIndex: number; block: bigint }
  | { type: "claim_proposed"; escrowId: number; payee: Address; kind: ClaimKind; tx: Hex; logIndex: number; block: bigint }
  | { type: "ready"; escrowId: number; readyAt: Date; tx: Hex; logIndex: number; block: bigint }
  | { type: "cancelled"; escrowId: number; by: Address; tx: Hex; logIndex: number; block: bigint }
  | { type: "paid"; escrowId: number; to: Address; amountMicros: number; reason: "claim" | "stop" | "unclaimed"; tx: Hex; logIndex: number; block: bigint };

export interface EscrowChain {
  readonly chainId: number;
  readonly escrow: Address;
  readonly fund: Address | null;
  readonly settlement: Address;
  /** The weekly batch, from the settlement wallet. Waits for the receipt. */
  depositBatch(items: Array<{ escrowId: number; amountMicros: number }>): Promise<{ txHash: Hex; blockNumber: bigint }>;
  /** The pool's fund share, into the creator fund. */
  contribute(amountMicros: number, source: string): Promise<{ txHash: Hex }>;
  /** Escrow events since `fromBlock`, oldest first, and the block read up to. */
  events(fromBlock: bigint): Promise<{ toBlock: bigint; events: EscrowEvent[] }>;
  /** What each verifier signs to approve a claim (for the Network desk to show). */
  approveCalldata(escrowId: number, payee: Address, kind: ClaimKind): Hex;
  balanceOf(escrowId: number): Promise<number>;
  /** Added 2026-09-29 (desk Settings, Escrow signers): the verifier keys and how many approve a claim, read from the contract. */
  signers?(): Promise<{ signers: string[]; threshold: number }>;
}

const REASONS = ["claim", "stop", "unclaimed"] as const;
const KINDS = { 1: "claim", 2: "stop" } as const;

export function escrowChain(config: { rpcUrl: string; escrow: Address; fund: Address | null; usdc: Address; settlementKey: Hex | null; chainId?: number; pollingIntervalMs?: number }): EscrowChain {
  // Without the settlement key (the API), it reads and encodes but never sends: only the worker sends.
  const account = config.settlementKey ? privateKeyToAccount(config.settlementKey) : null;
  const signer = () => {
    if (!account) throw new Error("This process can't send transactions (no SETTLEMENT_PRIVATE_KEY): the worker sends them.");
    return account;
  };
  const transport = http(config.rpcUrl);
  const chain = config.chainId ? { id: config.chainId, name: `chain ${config.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } } : undefined;
  // Base makes a block every 2 seconds; anvil makes one per transaction.
  const pub: PublicClient = createPublicClient({ transport, chain, pollingInterval: config.pollingIntervalMs ?? 1_000 });
  const wallet: WalletClient = createWalletClient({ ...(account ? { account } : {}), transport, chain });
  let chainId = config.chainId ?? 0;

  async function ensureAllowance(spender: Address, amount: bigint) {
    const from = signer();
    const allowance = (await pub.readContract({ address: config.usdc, abi: erc20Abi, functionName: "allowance", args: [from.address, spender] })) as bigint;
    if (allowance >= amount) return;
    const hash = await wallet.writeContract({ address: config.usdc, abi: erc20Abi, functionName: "approve", args: [spender, 2n ** 256n - 1n], account: from, chain: wallet.chain ?? null });
    await pub.waitForTransactionReceipt({ hash });
  }

  return {
    get chainId() {
      return chainId;
    },
    escrow: config.escrow,
    fund: config.fund,
    settlement: account?.address ?? ("0x0000000000000000000000000000000000000000" as Address),

    async depositBatch(items) {
      if (!chainId) chainId = await pub.getChainId();
      const total = items.reduce((s, i) => s + BigInt(i.amountMicros), 0n);
      await ensureAllowance(config.escrow, total);
      const hash = await wallet.writeContract({
        address: config.escrow,
        abi: creatorEscrowAbi,
        functionName: "depositBatch",
        args: [items.map((i) => BigInt(i.escrowId)), items.map((i) => BigInt(i.amountMicros))],
        account: signer(),
        chain: wallet.chain ?? null
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Escrow deposit ${hash} reverted`);
      return { txHash: hash, blockNumber: receipt.blockNumber };
    },

    async contribute(amountMicros, source) {
      if (!config.fund) throw new Error("CREATOR_FUND_ADDRESS isn't set.");
      await ensureAllowance(config.fund, BigInt(amountMicros));
      const sourceBytes = `0x${Buffer.from(source.slice(0, 32)).toString("hex").padEnd(64, "0")}` as Hex;
      const hash = await wallet.writeContract({ address: config.fund, abi: creatorFundAbi, functionName: "contribute", args: [BigInt(amountMicros), sourceBytes], account: signer(), chain: wallet.chain ?? null });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Fund contribution ${hash} reverted`);
      return { txHash: hash };
    },

    async events(fromBlock) {
      // Uncached: a sync right after a transaction must see its block.
      const toBlock = await pub.getBlockNumber({ cacheTime: 0 });
      if (fromBlock > toBlock) return { toBlock: fromBlock - 1n, events: [] };
      const get = <T extends string>(signature: T) => pub.getLogs({ address: config.escrow, event: parseAbiItem(signature as never), fromBlock, toBlock });
      const [deposited, proposed, ready, cancelled, paid] = await Promise.all([
        get("event Deposited(uint256 indexed stationId, uint256 amount, address indexed forwardedTo)"),
        get("event ClaimProposed(uint256 indexed stationId, address payee, uint8 kind)"),
        get("event Ready(uint256 indexed key, bytes32 subject, uint256 readyAt)"),
        get("event Cancelled(uint256 indexed key, address indexed by)"),
        get("event Paid(uint256 indexed stationId, address indexed to, uint256 amount, uint8 reason)")
      ]);
      const at = (l: { transactionHash: Hex | null; logIndex: number | null; blockNumber: bigint | null }) => ({ tx: l.transactionHash!, logIndex: l.logIndex!, block: l.blockNumber! });
      const events: EscrowEvent[] = [];
      for (const l of deposited as unknown as Array<{ args: { stationId: bigint; amount: bigint; forwardedTo: Address }; transactionHash: Hex; logIndex: number; blockNumber: bigint }>) {
        const forwarded = l.args.forwardedTo === "0x0000000000000000000000000000000000000000" ? null : l.args.forwardedTo;
        events.push({ type: "deposited", escrowId: Number(l.args.stationId), amountMicros: Number(l.args.amount), forwardedTo: forwarded, ...at(l) });
      }
      for (const l of proposed as unknown as Array<{ args: { stationId: bigint; payee: Address; kind: number }; transactionHash: Hex; logIndex: number; blockNumber: bigint }>) {
        events.push({ type: "claim_proposed", escrowId: Number(l.args.stationId), payee: l.args.payee, kind: KINDS[l.args.kind as 1 | 2], ...at(l) });
      }
      for (const l of ready as unknown as Array<{ args: { key: bigint; readyAt: bigint }; transactionHash: Hex; logIndex: number; blockNumber: bigint }>) {
        events.push({ type: "ready", escrowId: Number(l.args.key), readyAt: new Date(Number(l.args.readyAt) * 1000), ...at(l) });
      }
      for (const l of cancelled as unknown as Array<{ args: { key: bigint; by: Address }; transactionHash: Hex; logIndex: number; blockNumber: bigint }>) {
        events.push({ type: "cancelled", escrowId: Number(l.args.key), by: l.args.by, ...at(l) });
      }
      for (const l of paid as unknown as Array<{ args: { stationId: bigint; to: Address; amount: bigint; reason: number }; transactionHash: Hex; logIndex: number; blockNumber: bigint }>) {
        events.push({ type: "paid", escrowId: Number(l.args.stationId), to: l.args.to, amountMicros: Number(l.args.amount), reason: REASONS[l.args.reason], ...at(l) });
      }
      events.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
      return { toBlock, events };
    },

    approveCalldata(escrowId, payee, kind) {
      return encodeFunctionData({ abi: creatorEscrowAbi, functionName: "approve", args: [BigInt(escrowId), payee, kind === "claim" ? 1 : 2] });
    },

    async balanceOf(escrowId) {
      return Number(await pub.readContract({ address: config.escrow, abi: creatorEscrowAbi, functionName: "balanceOf", args: [BigInt(escrowId)] }));
    },

    async signers() {
      const [keys, threshold] = await Promise.all([
        pub.readContract({ address: config.escrow, abi: creatorEscrowAbi, functionName: "keys", args: [] }) as Promise<readonly Address[]>,
        pub.readContract({ address: config.escrow, abi: creatorEscrowAbi, functionName: "threshold", args: [] }) as Promise<bigint>
      ]);
      return { signers: [...keys], threshold: Number(threshold) };
    }
  };
}

/** The chain from the environment, or null (the ledger keeps claimable earnings as owed until it's set). */
export function chainFromEnv(env: NodeJS.ProcessEnv): EscrowChain | null {
  const { CHAIN_RPC_URL, ESCROW_CONTRACT_ADDRESS, USDC_ADDRESS, SETTLEMENT_PRIVATE_KEY } = env;
  if (!CHAIN_RPC_URL || !ESCROW_CONTRACT_ADDRESS || !USDC_ADDRESS) return null;
  return escrowChain({
    rpcUrl: CHAIN_RPC_URL,
    escrow: ESCROW_CONTRACT_ADDRESS as Address,
    fund: (env.CREATOR_FUND_ADDRESS as Address | undefined) ?? null,
    usdc: USDC_ADDRESS as Address,
    settlementKey: (SETTLEMENT_PRIVATE_KEY as Hex | undefined) || null,
    chainId: env.CHAIN_ID ? Number(env.CHAIN_ID) : undefined
  });
}
