// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Upgrades, Options} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {CreatorFund} from "../src/CreatorFund.sol";
import {ThresholdApprovals} from "../src/ThresholdApprovals.sol";
import {CreatorFundV2} from "./mocks/CreatorFundV2.sol";
import {Deployed} from "./Deployed.sol";

contract CreatorFundTest is Deployed {
    address newStation = makeAddr("a new station's wallet");
    bytes32 constant REF = keccak256("grant: Fontana Kitchen, first season");

    function setUp() public override {
        super.setUp();
        usdc.watch(address(fund));
        vm.prank(opencast);
        fund.contribute(10_000 * USD, bytes32("pool:2026-09"));
    }

    function _propose(address by, address to, uint256 amount) internal returns (uint256 id) {
        vm.prank(by);
        id = fund.proposeGrant(to, amount, REF);
    }

    function _approvedGrant(address to, uint256 amount) internal returns (uint256 id) {
        id = _propose(s1, to, amount);
        vm.prank(s2);
        fund.approveGrant(id);
    }

    function test_itTakesThePoolsShareAndWhatsNeverClaimed() public {
        (uint256 contributed,) = fund.totals();
        assertEq(contributed, 10_000 * USD);
        // A claimable station's balance, three years unclaimed.
        vm.prank(opencast);
        escrow.deposit(33, 700 * USD);
        vm.warp(block.timestamp + THREE_YEARS);
        escrow.releaseToFund(33);
        assertEq(fund.balance(), 10_700 * USD);
    }

    function test_aGrantNeedsTheThresholdAnd72HoursInPublic() public {
        uint256 id = _propose(s1, newStation, 2_500 * USD);
        (, uint256 approvals, uint256 readyAt) = fund.proposal(id);
        assertEq(approvals, 1, "proposing counts as the first approval");
        assertEq(readyAt, 0);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        fund.executeGrant(id);

        vm.prank(s3);
        fund.approveGrant(id);
        vm.warp(block.timestamp + 72 hours - 1);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        fund.executeGrant(id);
        vm.warp(block.timestamp + 1);

        vm.expectEmit(address(fund));
        emit CreatorFund.GrantPaid(id, newStation, 2_500 * USD, REF);
        vm.prank(attacker); // anyone can pay it; it pays the recipient
        fund.executeGrant(id);
        assertEq(usdc.balanceOf(newStation), 2_500 * USD);
        (, uint256 granted) = fund.totals();
        assertEq(granted, 2_500 * USD);

        vm.expectRevert(CreatorFund.NoSuchGrant.selector);
        fund.executeGrant(id);
    }

    function test_anyOneStewardCanCancelAGrantForGood() public {
        uint256 id = _approvedGrant(attacker, 9_000 * USD);
        vm.prank(s3);
        fund.cancelGrant(id);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(CreatorFund.NoSuchGrant.selector);
        fund.executeGrant(id);
        vm.prank(s1);
        vm.expectRevert(CreatorFund.NoSuchGrant.selector);
        fund.approveGrant(id);
        assertEq(usdc.outCount(), 0);
    }

    function test_onlyStewardsProposeApproveOrCancel() public {
        vm.prank(attacker);
        vm.expectRevert(ThresholdApprovals.NotAKey.selector);
        fund.proposeGrant(attacker, 1 * USD, REF);
        uint256 id = _propose(s1, newStation, 1 * USD);
        address[3] memory others = [attacker, safe, v1];
        for (uint256 i; i < others.length; ++i) {
            vm.startPrank(others[i]);
            vm.expectRevert(ThresholdApprovals.NotAKey.selector);
            fund.approveGrant(id);
            vm.expectRevert(ThresholdApprovals.NotAKey.selector);
            fund.cancelGrant(id);
            vm.stopPrank();
        }
    }

    function test_neverToOpencastAStewardOrItself() public {
        address[5] memory bad = [opencast, treasury, s2, address(fund), address(0)];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(s1);
            vm.expectRevert(CreatorFund.BadRecipient.selector);
            fund.proposeGrant(bad[i], 1 * USD, REF);
        }
    }

    function test_anExclusionAddedAfterApprovalStillStopsIt() public {
        address opencastNewWallet = makeAddr("opencast's new wallet");
        uint256 id = _approvedGrant(opencastNewWallet, 100 * USD);
        _throughTimelock(address(fund), abi.encodeCall(CreatorFund.exclude, (opencastNewWallet)));
        assertTrue(fund.isExcluded(opencastNewWallet));
        vm.expectRevert(CreatorFund.BadRecipient.selector);
        fund.executeGrant(id);
    }

    function test_aRecipientMadeAStewardIsRefused() public {
        uint256 id = _approvedGrant(newStation, 100 * USD);
        _throughTimelock(address(fund), abi.encodeCall(CreatorFund.setStewards, (_three(s1, s2, newStation), 2)));
        // New keys void old approvals, and a steward can't be paid anyway.
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        fund.executeGrant(id);
        vm.prank(s1);
        fund.approveGrant(id);
        vm.prank(s2);
        fund.approveGrant(id);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(CreatorFund.BadRecipient.selector);
        fund.executeGrant(id);
    }

    function test_itCantPayMoreThanItHas() public {
        uint256 id = _approvedGrant(newStation, 20_000 * USD);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(CreatorFund.NotEnough.selector);
        fund.executeGrant(id);
        // It can be paid once there's enough.
        vm.prank(opencast);
        fund.contribute(10_000 * USD, bytes32("pool:2026-10"));
        fund.executeGrant(id);
        assertEq(usdc.balanceOf(newStation), 20_000 * USD);
    }

    function test_approvalsMustBeForTheGrantAsProposed() public {
        uint256 id = _propose(s1, newStation, 10 * USD);
        vm.prank(s1);
        vm.expectRevert(ThresholdApprovals.AlreadyApproved.selector);
        fund.approveGrant(id);
        vm.prank(s2);
        vm.expectRevert(CreatorFund.NoSuchGrant.selector);
        fund.approveGrant(id + 1);
    }

    function test_noOneButTheTimelockAdministersIt() public {
        address next = address(new CreatorFundV2());
        address[4] memory callers = [attacker, safe, s1, v1];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            bytes memory denied = abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], bytes32(0)
            );
            vm.expectRevert(denied);
            fund.upgradeToAndCall(next, "");
            vm.expectRevert(denied);
            fund.exclude(attacker);
            vm.expectRevert(denied);
            fund.setStewards(_three(attacker, s2, s3), 2);
            vm.stopPrank();
        }
    }

    function test_anUpgradeKeepsTheFundAndItsGrants() public {
        uint256 id = _approvedGrant(newStation, 300 * USD);
        _throughTimelock(
            address(fund), abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(new CreatorFundV2()), ""))
        );
        assertEq(CreatorFundV2(address(fund)).version(), 2);
        assertEq(fund.balance(), 10_000 * USD);
        assertTrue(fund.isExcluded(treasury));
        fund.executeGrant(id); // the week in the timelock covered its 72 hours
        assertEq(usdc.balanceOf(newStation), 300 * USD);
    }

    function test_theOnlyFunctionsAreThese() public view {
        string[29] memory list = [
            "contribute(uint256,bytes32)",
            "proposeGrant(address,uint256,bytes32)",
            "approveGrant(uint256)",
            "cancelGrant(uint256)",
            "executeGrant(uint256)",
            "setStewards(address[],uint256)",
            "exclude(address)",
            "upgradeToAndCall(address,bytes)",
            "initialize(address,address[],uint256,address[],address)",
            "DEFAULT_ADMIN_ROLE()",
            "getRoleAdmin(bytes32)",
            "grantRole(bytes32,address)",
            "hasRole(bytes32,address)",
            "renounceRole(bytes32,address)",
            "revokeRole(bytes32,address)",
            "supportsInterface(bytes4)",
            "UPGRADE_INTERFACE_VERSION()",
            "proxiableUUID()",
            "WAITING_PERIOD()",
            "MAX_KEYS()",
            "isKey(address)",
            "keys()",
            "threshold()",
            "proposal(uint256)",
            "usdc()",
            "balance()",
            "grant(uint256)",
            "isExcluded(address)",
            "totals()"
        ];
        string[] memory allowed = new string[](list.length);
        for (uint256 i; i < list.length; ++i) {
            allowed[i] = list[i];
        }
        _onlyTheseFunctions("out/CreatorFund.sol/CreatorFund.json", allowed);
    }

    function test_upgradeSafetyCheckedByOpenZeppelin() public {
        Options memory opts;
        Upgrades.validateImplementation("CreatorFund.sol", opts);
        opts.referenceContract = "CreatorFund.sol";
        Upgrades.validateUpgrade("CreatorFundV2.sol", opts);
    }

    function test_theEscrowStillCantPayTheFundEarly() public {
        vm.prank(opencast);
        escrow.deposit(33, 1 * USD);
        vm.expectRevert(CreatorEscrow.StillClaimable.selector);
        escrow.releaseToFund(33);
    }
}
