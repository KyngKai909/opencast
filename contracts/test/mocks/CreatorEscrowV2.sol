// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreatorEscrow} from "../../src/CreatorEscrow.sol";

/// A next version for the upgrade tests: the same storage, one new view. It adds no state, so it
/// needs no initializer.
/// @custom:oz-upgrades-from CreatorEscrow
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract CreatorEscrowV2 is CreatorEscrow {
    function version() external pure returns (uint256) {
        return 2;
    }
}
