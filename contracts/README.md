# contracts

`CreatorEscrow`: where a claimable station's earnings wait for its creator. Foundry; nothing here is part of the npm workspaces.

```bash
cd contracts
forge test                                  # unit, fuzz and invariant tests
forge test --mc CreatorEscrowGas -vv        # gas of a weekly batch and the claim path
anvil &                                      # a local chain (or the "opencast-chain" launch entry)
forge script script/DeployEscrow.s.sol --rpc-url local --broadcast \
  --private-key $(cast wallet private-key "test test test test test test test test test test test junk" 0)
```

On a fresh anvil the addresses are always the same: mock USDC `0x5FbDB2315678afecb367f032d93F642f64180aa3`, escrow `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (verifiers: anvil accounts 1 to 3, 2 of 3; creator fund: account 4).

## How money gets out

Each station is keyed by its `escrow_id` (a number in `broadcast.stations`, not its channel, which can be released). USDC comes in with `deposit` or the weekly `depositBatch`, pulled from Opencast's settlement wallet. It leaves three ways, and only to two kinds of address:

| Way out | Who can start it | Pays | When |
|---|---|---|---|
| Claim | `threshold` verifiers approve the same claim (payee and kind); anyone then calls `execute` | the approved creator wallet | 72 hours after the last approval, unless any one verifier cancels first |
| Stop | same as Claim, kind `Stop` (the creator wants the station signed off) | the approved creator wallet | same |
| Unclaimed | anyone calls `releaseToFund` | the creator fund, fixed at deployment | `unclaimedPeriod` (3 years by default) after the station's first deposit, unless an approved claim is waiting out its 72 hours |

After a claim or stop, later deposits for that station are owed to the creator; after an unclaimed release, to the fund. `flush(to)` pays out what's owed to `to`, and nothing else.

There is no owner, admin, pause, rescue or upgrade. The token, fund, verifiers, threshold and unclaimed period are set in the constructor and can't change. Verifiers can't name themselves, the fund or the contract as a payee. `test_theOnlyFunctionsAreTheseAndNoneIsAnAdmin` fails if a function is ever added, and checks the deployed code has no `DELEGATECALL` or `SELFDESTRUCT`.

## Tests

- **Unit** (`CreatorEscrow.t.sol`): each path, each refusal, and every route to an address that isn't the approved creator or the fund. That includes a stranger calling everything, verifiers naming themselves, two compromised keys cancelled by the third, a blocked wallet replaced by a new claim, and one key trying to hold back the fund.
- **Invariants** (`CreatorEscrow.invariant.t.sol`): 256 runs × 64 random calls from verifiers, strangers, payees and Opencast. After every run:
  - every USDC that left went to the fund, or to a payee the threshold approved, no earlier than their 72 hours;
  - deposits = held + paid out, exactly.

## Gas (weekly deposit batch)

Measured on anvil as real transactions:

| Stations in the batch | First week (new storage) | Later weeks |
|---|---|---|
| 10 | 344,818 | 137,308 |
| 100 | ~2,640,000 | 902,128 |

The claim path: first approval about 80k, the approval that reaches the threshold about 65k, and `execute` about 125k.

On Base at the price when measured (0.006 gwei, 2026-09-28), a 100-station week costs about 0.0000054 ETH in execution plus under 0.0000002 ETH in L1 data: **around 2 cents** at $3,500/ETH. The first week is about 6 cents.

## Deploying to Base

The prompt says to build for the chain Clear uses: Base. Set:
- `USDC_ADDRESS`: Circle's USDC on Base or Base Sepolia. Check it against Circle's published list.
- `CREATOR_FUND_ADDRESS`
- `ESCROW_VERIFIERS`: comma-separated, at least 2.
- `ESCROW_THRESHOLD`
- `UNCLAIMED_PERIOD_DAYS`

Then run the script with `--rpc-url base_sepolia` (or `base`) and a deployer key. Whether it stays in Opencast's repo or moves to the Clear protocol is open; see `docs/open-decisions.md`.
