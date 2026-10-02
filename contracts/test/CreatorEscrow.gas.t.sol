// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {Deployed} from "./Deployed.sol";

/// The weekly deposit batch through the proxy, measured: the first week a station appears (new
/// storage) and a normal week after (updating it). Run: forge test --mc CreatorEscrowGas -vv
contract CreatorEscrowGas is Deployed {
    function _batch(uint256 n, uint256 offset) internal returns (uint256 gas) {
        uint256[] memory ids = new uint256[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = offset + i;
            amounts[i] = 12_345_678 + i;
        }
        vm.prank(opencast);
        escrow.depositBatch(ids, amounts);
        gas = vm.lastFrameGas().gasTotalUsed;
    }

    function test_weeklyBatchGas() public {
        uint256[4] memory sizes = [uint256(1), 10, 50, 100];
        for (uint256 k; k < sizes.length; ++k) {
            uint256 offset = 10_000 * (k + 1);
            uint256 first = _batch(sizes[k], offset);
            uint256 later = _batch(sizes[k], offset);
            console.log("stations", sizes[k]);
            console.log("  first week gas", first, "per station", first / sizes[k]);
            console.log("  later weeks gas", later, "per station", later / sizes[k]);
        }
    }

    function test_claimPathGas() public {
        vm.prank(opencast);
        escrow.deposit(1, 1e6);
        vm.prank(v1);
        escrow.approve(1, creator, CreatorEscrow.Kind.Claim);
        console.log("approve (first key)", vm.lastFrameGas().gasTotalUsed);
        vm.prank(v2);
        escrow.approve(1, creator, CreatorEscrow.Kind.Claim);
        console.log("approve (threshold)", vm.lastFrameGas().gasTotalUsed);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(1);
        console.log("execute", vm.lastFrameGas().gasTotalUsed);
    }
}
