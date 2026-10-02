// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {CreatorFund} from "../src/CreatorFund.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// Deploys the creator fund and the escrow behind UUPS proxies (checked by OpenZeppelin's upgrade
/// validator), with their admin role held by a timelock:
///
///   USDC_ADDRESS            the token (Base: Circle's USDC). Unset on a local chain: a mock is deployed.
///   ADMIN_SAFE              Opencast's Safe: proposes and executes admin changes through the timelock
///   UPGRADE_DELAY_DAYS      how long every admin change waits in public (default 7)
///   ESCROW_VERIFIERS        comma-separated verifier keys; ESCROW_THRESHOLD (default 2)
///   FUND_STEWARDS           comma-separated steward keys; FUND_THRESHOLD (default 2)
///   FUND_EXCLUDED           Opencast's own wallets, which grants may never pay (the deployer and
///                           the Safe are always added)
///   UNCLAIMED_PERIOD_DAYS   default 1095 (3 years)
///
/// Every verifier and steward can cancel a scheduled admin change.
///
/// Local:  anvil & forge script script/DeployEscrow.s.sol --rpc-url local --broadcast --private-key <anvil key 0>
contract DeployEscrow is Script {
    struct Config {
        address token;
        address safe;
        uint256 delay;
        address[] verifiers;
        address[] stewards;
        address[] excluded;
        uint256 escrowThreshold;
        uint256 fundThreshold;
        uint256 period;
    }

    function run() external {
        Config memory c = _config();
        vm.startBroadcast();
        address deployer = msg.sender;
        if (c.token == address(0)) c.token = _mockUsdc(deployer);
        address timelock = _timelock(c, deployer);
        address[] memory excluded = new address[](c.excluded.length + 2);
        excluded[0] = deployer;
        excluded[1] = c.safe;
        for (uint256 i; i < c.excluded.length; ++i) {
            excluded[i + 2] = c.excluded[i];
        }
        address fund = Upgrades.deployUUPSProxy(
            "CreatorFund.sol",
            abi.encodeCall(CreatorFund.initialize, (IERC20(c.token), c.stewards, c.fundThreshold, excluded, timelock))
        );
        address escrow = Upgrades.deployUUPSProxy(
            "CreatorEscrow.sol",
            abi.encodeCall(
                CreatorEscrow.initialize, (IERC20(c.token), fund, c.verifiers, c.escrowThreshold, c.period, timelock)
            )
        );
        vm.stopBroadcast();

        console.log("USDC           ", c.token);
        console.log("Timelock       ", timelock);
        console.log("CreatorFund    ", fund);
        console.log("CreatorEscrow  ", escrow);
        console.log("admin Safe     ", c.safe);
        console.log("verifiers", c.verifiers.length, "threshold", c.escrowThreshold);
        console.log("stewards ", c.stewards.length, "threshold", c.fundThreshold);
    }

    function _config() private view returns (Config memory c) {
        bool local = block.chainid == 31337;
        c.token = vm.envOr("USDC_ADDRESS", address(0));
        c.safe = vm.envOr("ADMIN_SAFE", local ? vm.addr(_anvilKey(9)) : address(0));
        c.delay = vm.envOr("UPGRADE_DELAY_DAYS", uint256(7)) * 1 days;
        c.verifiers = vm.envOr("ESCROW_VERIFIERS", ",", _anvilAddresses(local, 1));
        c.stewards = vm.envOr("FUND_STEWARDS", ",", _anvilAddresses(local, 4));
        c.excluded = vm.envOr("FUND_EXCLUDED", ",", new address[](0));
        c.escrowThreshold = vm.envOr("ESCROW_THRESHOLD", uint256(2));
        c.fundThreshold = vm.envOr("FUND_THRESHOLD", uint256(2));
        c.period = vm.envOr("UNCLAIMED_PERIOD_DAYS", uint256(1095)) * 1 days;
        require(local || c.token != address(0), "Set USDC_ADDRESS");
        require(c.safe != address(0), "Set ADMIN_SAFE");
        require(c.verifiers.length >= 2 && c.stewards.length >= 2, "Set ESCROW_VERIFIERS and FUND_STEWARDS");
    }

    function _mockUsdc(address deployer) private returns (address) {
        MockUSDC mock = new MockUSDC();
        // The local settlement wallet (anvil account 0) starts with $1,000,000 of test USDC.
        mock.mint(deployer, 1_000_000e6);
        return address(mock);
    }

    /// The admin of both contracts: the Safe proposes and executes after the delay; every verifier
    /// and steward can cancel. The deployer gives up its setup role at the end.
    function _timelock(Config memory c, address deployer) private returns (address) {
        address[] memory proposers = new address[](1);
        proposers[0] = c.safe;
        TimelockController timelock = new TimelockController(c.delay, proposers, proposers, deployer);
        bytes32 canceller = timelock.CANCELLER_ROLE();
        for (uint256 i; i < c.verifiers.length; ++i) {
            timelock.grantRole(canceller, c.verifiers[i]);
        }
        for (uint256 i; i < c.stewards.length; ++i) {
            timelock.grantRole(canceller, c.stewards[i]);
        }
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);
        return address(timelock);
    }

    /// Three anvil development accounts from `first` (local only).
    function _anvilAddresses(bool local, uint256 first) private pure returns (address[] memory list) {
        if (!local) return new address[](0);
        list = new address[](3);
        for (uint256 i; i < 3; ++i) {
            list[i] = vm.addr(_anvilKey(first + i));
        }
    }

    /// anvil's development accounts, from its public test mnemonic (never used on a real chain).
    function _anvilKey(uint256 i) private pure returns (uint256) {
        return vm.deriveKey("test test test test test test test test test test test junk", uint32(i));
    }
}
