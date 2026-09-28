// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CreatorEscrow, IERC20} from "../src/CreatorEscrow.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// Deploys CreatorEscrow. Everything it depends on is fixed here, forever:
///
///   USDC_ADDRESS           the token (Base: Circle's USDC). Unset on a local chain: a mock is deployed.
///   CREATOR_FUND_ADDRESS   where unclaimed balances go
///   ESCROW_VERIFIERS       comma-separated verifier keys (a multi-signature)
///   ESCROW_THRESHOLD       how many must approve a claim (at least 2)
///   UNCLAIMED_PERIOD_DAYS  default 1095 (3 years)
///
/// Local:  anvil & forge script script/DeployEscrow.s.sol --rpc-url local --broadcast --private-key <anvil key 0>
contract DeployEscrow is Script {
    function run() external returns (CreatorEscrow escrow) {
        bool local = block.chainid == 31337;
        address token = vm.envOr("USDC_ADDRESS", address(0));
        address fund = vm.envOr("CREATOR_FUND_ADDRESS", local ? vm.addr(_anvilKey(4)) : address(0));
        address[] memory verifiers = vm.envOr("ESCROW_VERIFIERS", ",", _localVerifiers(local));
        uint256 threshold = vm.envOr("ESCROW_THRESHOLD", uint256(2));
        uint256 period = vm.envOr("UNCLAIMED_PERIOD_DAYS", uint256(1095)) * 1 days;
        require(local || token != address(0), "Set USDC_ADDRESS");
        require(fund != address(0), "Set CREATOR_FUND_ADDRESS");

        vm.startBroadcast();
        if (token == address(0)) {
            MockUSDC mock = new MockUSDC();
            // The local settlement wallet (anvil account 0) starts with $1,000,000 of test USDC.
            mock.mint(msg.sender, 1_000_000e6);
            token = address(mock);
        }
        escrow = new CreatorEscrow(IERC20(token), fund, verifiers, threshold, period);
        vm.stopBroadcast();

        console.log("USDC          ", token);
        console.log("CreatorEscrow ", address(escrow));
        console.log("creator fund  ", fund);
        console.log("threshold     ", threshold, "of", verifiers.length);
    }

    function _localVerifiers(bool local) private pure returns (address[] memory v) {
        if (!local) return new address[](0);
        v = new address[](3);
        for (uint256 i; i < 3; ++i) {
            v[i] = vm.addr(_anvilKey(i + 1));
        }
    }

    /// anvil's development accounts, from its public test mnemonic (never used on a real chain).
    function _anvilKey(uint256 i) private pure returns (uint256) {
        return vm.deriveKey("test test test test test test test test test test test junk", uint32(i));
    }
}
