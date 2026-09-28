// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {CreatorFund} from "../src/CreatorFund.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Everything deployed as it will be in production: both contracts behind UUPS proxies, their
/// admin role held by a 7-day timelock that Opencast's Safe proposes to and any verifier or
/// steward can cancel.
abstract contract Deployed is Test {
    uint256 constant USD = 1e6;
    uint256 constant THREE_YEARS = 1095 days;
    uint256 constant UPGRADE_DELAY = 7 days;

    MockUSDC usdc;
    TimelockController timelock;
    CreatorEscrow escrow;
    CreatorFund fund;

    address opencast = makeAddr("opencast settlement wallet");
    address treasury = makeAddr("opencast treasury");
    address safe = makeAddr("opencast safe");
    address v1 = makeAddr("verifier 1");
    address v2 = makeAddr("verifier 2");
    address v3 = makeAddr("verifier 3");
    address s1 = makeAddr("steward 1");
    address s2 = makeAddr("steward 2");
    address s3 = makeAddr("steward 3");
    address creator = makeAddr("creator (Tia Lupe)");
    address attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();

        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        timelock = new TimelockController(UPGRADE_DELAY, proposers, proposers, address(this));
        address[6] memory cancellers = [v1, v2, v3, s1, s2, s3];
        for (uint256 i; i < cancellers.length; ++i) {
            timelock.grantRole(timelock.CANCELLER_ROLE(), cancellers[i]);
        }
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        address[] memory excluded = new address[](2);
        excluded[0] = opencast;
        excluded[1] = treasury;
        fund = CreatorFund(
            address(
                new ERC1967Proxy(
                    address(new CreatorFund()),
                    abi.encodeCall(
                        CreatorFund.initialize,
                        (IERC20(address(usdc)), _three(s1, s2, s3), 2, excluded, address(timelock))
                    )
                )
            )
        );
        escrow = _deployEscrow(THREE_YEARS);

        usdc.watch(address(escrow));
        usdc.mint(opencast, 1_000_000 * USD);
        vm.startPrank(opencast);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.approve(address(fund), type(uint256).max);
        vm.stopPrank();
    }

    function _deployEscrow(uint256 unclaimed) internal returns (CreatorEscrow) {
        return CreatorEscrow(
            address(
                new ERC1967Proxy(
                    address(new CreatorEscrow()),
                    abi.encodeCall(
                        CreatorEscrow.initialize,
                        (IERC20(address(usdc)), address(fund), _three(v1, v2, v3), 2, unclaimed, address(timelock))
                    )
                )
            )
        );
    }

    function _three(address a, address b, address c) internal pure returns (address[] memory list) {
        list = new address[](3);
        (list[0], list[1], list[2]) = (a, b, c);
    }

    /// Runs `data` on `target` through the timelock: the Safe schedules it, a week passes, the Safe executes.
    function _throughTimelock(address target, bytes memory data) internal {
        bytes32 salt = keccak256(abi.encode(target, data, block.timestamp));
        vm.prank(safe);
        timelock.schedule(target, 0, data, bytes32(0), salt, UPGRADE_DELAY);
        vm.warp(block.timestamp + UPGRADE_DELAY);
        vm.prank(safe);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    /// The contract's whole external surface, from the build output, must be exactly `allowed`.
    function _onlyTheseFunctions(string memory artifact, string[] memory allowed) internal view {
        string[] memory found = vm.parseJsonKeys(vm.readFile(artifact), ".methodIdentifiers");
        assertEq(found.length, allowed.length, "the contract's functions changed");
        for (uint256 i; i < found.length; ++i) {
            bool ok;
            for (uint256 j; j < allowed.length; ++j) {
                if (keccak256(bytes(found[i])) == keccak256(bytes(allowed[j]))) ok = true;
            }
            assertTrue(ok, found[i]);
        }
    }
}
