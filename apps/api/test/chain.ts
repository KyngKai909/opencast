// A private anvil chain with CreatorFund and CreatorEscrow deployed from the Foundry build, for
// tests that go all the way on-chain. Needs `forge` and `anvil` (brew install foundry).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, type Abi, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { creatorEscrowAbi, creatorFundAbi } from "../src/v1/chain/abis.js";

const contracts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts");
const MNEMONIC = "test test test test test test test test test test test junk";
export const anvilAccount = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
/** anvil's development keys (public; never used on a real chain). */
export const anvilKey = (i: number) => `0x${Buffer.from(anvilAccount(i).getHdKey().privateKey!).toString("hex")}` as Hex;

export function foundryAvailable() {
  return spawnSync("anvil", ["--version"]).status === 0 && spawnSync("forge", ["--version"]).status === 0;
}

const artifact = (file: string, name: string) => {
  const json = JSON.parse(readFileSync(path.join(contracts, "out", file, `${name}.json`), "utf8"));
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex };
};

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

export interface TestChain {
  rpcUrl: string;
  usdc: Address;
  escrow: Address;
  fund: Address;
  /** Moves the chain's clock forward and mines a block. */
  warp(seconds: number): Promise<void>;
  /** Sends a transaction to the escrow as one of anvil's accounts (verifiers are 1 to 3). */
  asAccount(i: number, fn: "approve" | "cancel" | "execute" | "releaseToFund", args: readonly unknown[]): Promise<void>;
  usdcBalance(address: Address): Promise<number>;
  stop(): void;
}

export async function startChain(): Promise<TestChain> {
  if (!existsSync(path.join(contracts, "out", "CreatorEscrow.sol", "CreatorEscrow.json"))) {
    const built = spawnSync("forge", ["build"], { cwd: contracts, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`forge build failed: ${built.stderr}`);
  }
  const port = await freePort();
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const deployer = createWalletClient({ account: anvilAccount(0), chain, transport: http(rpcUrl) });
  const deploy = async (file: string, name: string, args: unknown[] = []) => {
    const a = artifact(file, name);
    const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  };
  const addresses = (ids: number[]) => ids.map((i) => anvilAccount(i).address);
  const admin = anvilAccount(9).address;

  const usdc = await deploy("MockUSDC.sol", "MockUSDC");
  const fundImpl = await deploy("CreatorFund.sol", "CreatorFund");
  const fund = await deploy("ERC1967Proxy.sol", "ERC1967Proxy", [
    fundImpl,
    encodeFunctionData({ abi: creatorFundAbi, functionName: "initialize", args: [usdc, addresses([4, 5, 6]), 2n, [anvilAccount(0).address, admin], admin] })
  ]);
  const escrowImpl = await deploy("CreatorEscrow.sol", "CreatorEscrow");
  const escrow = await deploy("ERC1967Proxy.sol", "ERC1967Proxy", [
    escrowImpl,
    encodeFunctionData({ abi: creatorEscrowAbi, functionName: "initialize", args: [usdc, fund, addresses([1, 2, 3]), 2n, 1095n * 86_400n, admin] })
  ]);
  // Opencast's settlement wallet (account 0) starts with test USDC.
  const mockAbi = artifact("MockUSDC.sol", "MockUSDC").abi;
  await pub.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: usdc, abi: mockAbi, functionName: "mint", args: [anvilAccount(0).address, 1_000_000_000_000n] }) });

  const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
  return {
    rpcUrl,
    usdc,
    escrow,
    fund,
    async warp(seconds) {
      await testClient.increaseTime({ seconds });
      await testClient.mine({ blocks: 1 });
    },
    async asAccount(i, fn, args) {
      const wallet = createWalletClient({ account: anvilAccount(i), chain, transport: http(rpcUrl) });
      const hash = await wallet.writeContract({ address: escrow, abi: creatorEscrowAbi, functionName: fn, args: args as never });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${fn} reverted`);
    },
    async usdcBalance(address) {
      return Number(await pub.readContract({ address: usdc, abi: mockAbi, functionName: "balanceOf", args: [address] }));
    },
    stop() {
      anvil.kill();
    }
  };
}
