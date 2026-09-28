// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreatorFund} from "../../src/CreatorFund.sol";

/// A next version for the upgrade tests: the same storage, one new view. It adds no state, so it
/// needs no initializer.
/// @custom:oz-upgrades-from CreatorFund
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract CreatorFundV2 is CreatorFund {
    function version() external pure returns (uint256) {
        return 2;
    }
}
