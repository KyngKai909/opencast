# contracts

`CreatorEscrow` holds claimable stations' earnings until the creator claims them. `CreatorFund` backs new stations and programs with what's never claimed and the pool's fund share. Both are built with Foundry, and neither is part of the npm workspaces.

```bash
cd contracts
forge clean && forge test                   # unit, fuzz, invariant and upgrade-safety tests (clean first: see below)
forge test --mc CreatorEscrowGas -vv        # gas of a weekly batch and the claim path
anvil &                                      # a local chain (or the "opencast-chain" launch entry)
forge clean && forge script script/DeployEscrow.s.sol --rpc-url local --broadcast \
  --private-key $(cast wallet private-key "test test test test test test test test test test test junk" 0)
```

On a fresh anvil the addresses are always the same:

| Contract | Address |
|---|---|
| mock USDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| timelock | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| CreatorFund | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` |
| CreatorEscrow | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` |

The anvil accounts used:
- account 0 deploys and is the settlement wallet;
- accounts 1 to 3 are the verifiers, 2 of 3;
- accounts 4 to 6 are the stewards, 2 of 3;
- account 9 is the admin Safe.

OpenZeppelin's upgrade checker runs through `ffi` (`npx @openzeppelin/upgrades-core`) and refuses to guess between stale build files, so run `forge clean` before tests and deploys.

## Upgrades and admin

Both contracts are UUPS proxies on OpenZeppelin 5 (`AccessControl`, ERC-7201 storage), like the Clear protocol's contracts. Each one's `DEFAULT_ADMIN_ROLE` is held by a `TimelockController`:
- the delay is 7 days;
- Opencast's Safe proposes and executes;
- every verifier and steward can cancel.

So any upgrade or admin change is public for a week, and one honest key can stop it.

The admin role can do these things, and nothing else:

| Contract | Admin can |
|---|---|
| CreatorEscrow | change the verifier keys (which voids claims in progress); authorize an upgrade |
| CreatorFund | change the stewards; add an address grants may never pay (never remove one); authorize an upgrade |

Neither contract has an admin function that moves money. The platform prompt asked for the escrow not to be upgradeable at all. It's upgradeable at the owner's request, to match the other contracts; the timelock is what keeps an upgrade from quietly adding a way out.

## CreatorEscrow: how money gets out

Each station is keyed by its `escrow_id`: a number in `broadcast.stations`, not its channel, which can be released. USDC comes in through `deposit` or the weekly `depositBatch`, pulled from Opencast's settlement wallet. It leaves three ways:

| Way out | How | Pays | When |
|---|---|---|---|
| Claim | `threshold` verifiers approve the same payee; anyone calls `execute` | the approved creator wallet | 72 hours after the threshold, unless any one verifier cancels |
| Stop | same, with kind `Stop` | the approved creator wallet | same |
| Unclaimed | anyone calls `releaseToFund` | `CreatorFund` | 3 years after the station's first deposit, unless an approved claim is waiting |

- After a claim, later deposits are owed to the creator. After a release, they're owed to the fund.
- `flush(to)` pays only what's owed to `to`.
- Verifiers can't name themselves, the fund or the contract as the payee.

## CreatorFund: how money gets out

Money comes in from `contribute` (the pool's fund share) and from the escrow's releases. It leaves only as grants:
1. A steward proposes one: recipient, amount, and a hash of the public grant record.
2. `threshold` stewards approve it.
3. It waits 72 hours in public, and any one steward can cancel it.
4. Anyone can pay it.

A grant never goes to a steward, the fund itself, or an excluded address. Opencast's settlement wallet and Safe are excluded from the start, so the fund can't pay Opencast. Exclusions and steward changes made after a grant was approved still apply when it's paid.

## Tests (46)

- **Escrow unit tests:**
  - each way in and out;
  - every refusal, and every route to someone who isn't the approved creator or the fund;
  - two compromised keys stopped by the third;
  - a blocked wallet replaced through a new claim;
  - one key trying to hold back the fund.
- **Fund unit tests:**
  - grants through their threshold and wait;
  - cancelled grants gone for good;
  - never to Opencast, a steward or itself, including exclusions added after approval;
  - no paying more than it holds.
- **Admin:**
  - only the timelock can upgrade, rotate keys or exclude;
  - a scheduled upgrade can't run before its week, and any verifier can cancel it;
  - an upgrade keeps every balance, claim and grant;
  - OpenZeppelin's upgrade checker passes both implementations and their V2s.
- **Function lists:** a test lists each contract's whole external surface and fails if a function is added.
- **Invariants:** 256 runs × 64 random calls to both contracts from verifiers, stewards, strangers, payees and Opencast, with claims and grants actually paid. After every run:
  - the escrow paid only the fund, or a threshold-approved payee after their 72 hours;
  - the fund paid only threshold-approved grants after their 72 hours, never to Opencast or a steward;
  - both ledgers add up exactly.

## Gas (weekly deposit batch, through the proxy)

Measured on anvil as real transactions:

| Stations in the batch | First week (new storage) | Later weeks |
|---|---|---|
| 10 | 351,863 | 144,353 |
| 100 | 2,647,232 | 914,132 |

On Base at the price when measured (0.006 gwei, 2026-09-28), a 100-station week costs about 0.0000055 ETH in execution, plus under 0.0000002 ETH in L1 data. That's **around 2 cents** at $3,500/ETH; the first week is about 6 cents.

## Deploying to Base

The prompt says to build for the chain Clear uses: Base. Set:
- `USDC_ADDRESS`: Circle's USDC on Base or Base Sepolia. Check it against Circle's published list.
- `ADMIN_SAFE`
- `ESCROW_VERIFIERS` and `ESCROW_THRESHOLD`
- `FUND_STEWARDS` and `FUND_THRESHOLD`
- `FUND_EXCLUDED` (optional)
- `UPGRADE_DELAY_DAYS` (default 7)
- `UNCLAIMED_PERIOD_DAYS` (default 1095)

Then run the script with `--rpc-url base_sepolia` (or `base`).
