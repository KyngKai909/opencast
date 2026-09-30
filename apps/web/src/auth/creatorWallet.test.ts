// A creator's wallet before a claim (catch-up report, section 5): Privy makes none at sign-in, so the
// claim makes the embedded one unless the person has an Ethereum wallet already.
import { describe, expect, it } from "vitest";
import type { User } from "@privy-io/react-auth";
import { mockWalletFor } from "./mockAuth";
import { existingWallet } from "./privyAuth";

const account = (a: Record<string, unknown>) => a as unknown as User["linkedAccounts"][number];

describe("a creator's wallet", () => {
  it("is the Ethereum wallet they already have, so none is made twice", () => {
    const user = { linkedAccounts: [account({ type: "email", address: "lupe@example.com" }), account({ type: "wallet", chainType: "ethereum", address: "0xAbC0000000000000000000000000000000000001" })] };
    expect(existingWallet(user)).toBe("0xAbC0000000000000000000000000000000000001");
  });

  it("is made at the claim when they signed in by email, or have only a Solana wallet or Clear", () => {
    expect(existingWallet(null)).toBeNull();
    expect(existingWallet({ linkedAccounts: [account({ type: "email", address: "lupe@example.com" })] })).toBeNull();
    expect(existingWallet({ linkedAccounts: [account({ type: "wallet", chainType: "solana", address: "So1ana" })] })).toBeNull();
    expect(existingWallet({ linkedAccounts: [account({ type: "cross_app", embeddedWallets: [{ address: "0x1" }] })] })).toBeNull();
  });

  it("is the same address every time in mock mode", () => {
    expect(mockWalletFor("lupe@example.com")).toMatch(/^0x[0-9a-f]{40}$/);
    expect(mockWalletFor("lupe@example.com")).toBe(mockWalletFor("lupe@example.com"));
    expect(mockWalletFor("lupe@example.com")).not.toBe(mockWalletFor("kai@example.com"));
  });
});
