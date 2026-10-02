// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Upgrades, Options} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {ThresholdApprovals} from "../src/ThresholdApprovals.sol";
import {CreatorEscrowV2} from "./mocks/CreatorEscrowV2.sol";
import {Deployed} from "./Deployed.sol";

contract CreatorEscrowTest is Deployed {
    uint256 constant LUPE = 33; // a station's escrow ID
    uint256 constant OTHER = 101;

    function _deposit(uint256 id, uint256 amount) internal {
        vm.prank(opencast);
        escrow.deposit(id, amount);
    }

    function _approve(address verifier, uint256 id, address payee, CreatorEscrow.Kind kind) internal {
        vm.prank(verifier);
        escrow.approve(id, payee, kind);
    }

    function _approved(uint256 id, address payee) internal {
        _approve(v1, id, payee, CreatorEscrow.Kind.Claim);
        _approve(v2, id, payee, CreatorEscrow.Kind.Claim);
    }

    function _approvals(uint256 id) internal view returns (uint256 approvals, uint256 readyAt) {
        (, approvals, readyAt) = escrow.proposal(id);
    }

    /// Nothing ever left the escrow for anyone but these two.
    function _onlyPaid(address a, address b) internal view {
        for (uint256 i; i < usdc.outCount(); ++i) {
            (, address to,,) = usdc.outs(i);
            assertTrue(to == a || to == b, "money went somewhere else");
        }
    }

    // ---- Setup -------------------------------------------------------------------

    function test_setupNeedsAMultisigAFundAndAnAdmin() public {
        CreatorEscrow impl = new CreatorEscrow();
        address[] memory one = new address[](1);
        one[0] = v1;
        bytes memory init = abi.encodeCall(
            CreatorEscrow.initialize, (IERC20(address(usdc)), address(fund), one, 1, THREE_YEARS, address(timelock))
        );
        vm.expectRevert(ThresholdApprovals.BadKeys.selector);
        _proxy(impl, init);
        init = abi.encodeCall(
            CreatorEscrow.initialize,
            (IERC20(address(usdc)), address(fund), _three(v1, v1, v2), 2, THREE_YEARS, address(timelock))
        );
        vm.expectRevert(ThresholdApprovals.BadKeys.selector);
        _proxy(impl, init);
        init = abi.encodeCall(
            CreatorEscrow.initialize,
            (IERC20(address(usdc)), address(fund), _three(v1, v2, address(fund)), 2, THREE_YEARS, address(timelock))
        );
        vm.expectRevert(ThresholdApprovals.BadKeys.selector);
        _proxy(impl, init);
        init = abi.encodeCall(
            CreatorEscrow.initialize,
            (IERC20(address(usdc)), address(0), _three(v1, v2, v3), 2, THREE_YEARS, address(timelock))
        );
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        _proxy(impl, init);
        init = abi.encodeCall(
            CreatorEscrow.initialize,
            (IERC20(address(usdc)), address(fund), _three(v1, v2, v3), 2, THREE_YEARS, address(0))
        );
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        _proxy(impl, init);
    }

    function test_itCantBeInitializedTwiceNorItsImplementationAtAll() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        escrow.initialize(IERC20(address(usdc)), attacker, _three(attacker, v2, v3), 2, THREE_YEARS, attacker);
        CreatorEscrow impl = new CreatorEscrow();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(IERC20(address(usdc)), attacker, _three(attacker, v2, v3), 2, THREE_YEARS, attacker);
    }

    function _proxy(CreatorEscrow impl, bytes memory init) internal returns (address) {
        return address(new ERC1967Proxy(address(impl), init));
    }

    // ---- In ----------------------------------------------------------------------

    function test_depositsAreHeldUnderTheStation() public {
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Deposited(LUPE, 125 * USD, address(0));
        _deposit(LUPE, 125 * USD);
        _deposit(LUPE, 25 * USD);
        assertEq(escrow.balanceOf(LUPE), 150 * USD);
        assertEq(escrow.totalHeld(), 150 * USD);
        assertEq(usdc.balanceOf(address(escrow)), 150 * USD);
        (, uint256 firstDepositAt,,) = escrow.station(LUPE);
        assertEq(firstDepositAt, block.timestamp);
    }

    function test_weeklyBatchIsOneTransferIn() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1], amounts[0], amounts[1]) = (LUPE, OTHER, 40 * USD, 60 * USD);
        vm.prank(opencast);
        escrow.depositBatch(ids, amounts);
        assertEq(escrow.balanceOf(LUPE), 40 * USD);
        assertEq(escrow.balanceOf(OTHER), 60 * USD);
        assertEq(usdc.balanceOf(address(escrow)), 100 * USD);

        uint256[] memory short = new uint256[](1);
        vm.prank(opencast);
        vm.expectRevert(CreatorEscrow.LengthMismatch.selector);
        escrow.depositBatch(ids, short);
        amounts[1] = 0;
        vm.prank(opencast);
        vm.expectRevert(CreatorEscrow.ZeroAmount.selector);
        escrow.depositBatch(ids, amounts);
    }

    function test_aDepositNeedsTheMoney() public {
        vm.prank(attacker);
        vm.expectRevert();
        escrow.deposit(LUPE, 1 * USD);
        assertEq(escrow.totalHeld(), 0);
    }

    // ---- Claim -------------------------------------------------------------------

    function test_claimPaysTheCreatorAfterApprovalAnd72Hours() public {
        _deposit(LUPE, 500 * USD);
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        (uint256 approvals, uint256 readyAt) = _approvals(LUPE);
        assertEq(approvals, 1);
        assertEq(readyAt, 0, "one key isn't enough");
        (address payee,) = escrow.claimOf(LUPE);
        assertEq(payee, creator);

        vm.expectEmit(address(escrow));
        emit ThresholdApprovals.Ready(
            LUPE, keccak256(abi.encode(creator, CreatorEscrow.Kind.Claim)), block.timestamp + 72 hours
        );
        _approve(v2, LUPE, creator, CreatorEscrow.Kind.Claim);

        vm.warp(block.timestamp + 72 hours - 1);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        escrow.execute(LUPE);

        vm.warp(block.timestamp + 1);
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Paid(LUPE, creator, 500 * USD, CreatorEscrow.Reason.Claim);
        vm.prank(attacker); // anyone can trigger it; it still pays the creator
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(creator), 500 * USD);
        assertEq(escrow.balanceOf(LUPE), 0);
        _onlyPaid(creator, creator);
    }

    function test_laterDepositsGoToTheClaimedCreator() public {
        _deposit(LUPE, 10 * USD);
        _approved(LUPE, creator);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);

        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Deposited(LUPE, 30 * USD, creator);
        _deposit(LUPE, 30 * USD);
        assertEq(escrow.forwarded(creator), 30 * USD);
        escrow.flush(creator);
        assertEq(usdc.balanceOf(creator), 40 * USD);
        assertEq(escrow.totalHeld(), 0);
    }

    function test_approvalsMustAgree() public {
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        vm.prank(v2);
        vm.expectRevert(ThresholdApprovals.DifferentSubject.selector);
        escrow.approve(LUPE, attacker, CreatorEscrow.Kind.Claim);
        vm.prank(v2);
        vm.expectRevert(ThresholdApprovals.DifferentSubject.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Stop);
        vm.prank(v1);
        vm.expectRevert(ThresholdApprovals.AlreadyApproved.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Claim);
    }

    function test_anyOneVerifierCanCancelDuringTheWait() public {
        _deposit(LUPE, 500 * USD);
        _approved(LUPE, attacker); // two keys compromised
        vm.warp(block.timestamp + 24 hours);
        vm.expectEmit(address(escrow));
        emit ThresholdApprovals.Cancelled(LUPE, v3);
        vm.prank(v3); // the honest one sees it in public and stops it
        escrow.cancel(LUPE);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        escrow.execute(LUPE);
        assertEq(escrow.balanceOf(LUPE), 500 * USD);

        // Approvals from before the cancel don't count again.
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        (uint256 approvals,) = _approvals(LUPE);
        assertEq(approvals, 1);
        assertEq(usdc.outCount(), 0);
    }

    function test_stopTakesTheSamePath() public {
        _deposit(LUPE, 80 * USD);
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Stop);
        _approve(v3, LUPE, creator, CreatorEscrow.Kind.Stop);
        vm.warp(block.timestamp + 72 hours);
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Paid(LUPE, creator, 80 * USD, CreatorEscrow.Reason.Stop);
        escrow.execute(LUPE);
        (,, CreatorEscrow.Status status, address payee) = escrow.station(LUPE);
        assertEq(uint8(status), uint8(CreatorEscrow.Status.Stopped));
        assertEq(payee, creator);
    }

    function test_aClosedStationTakesNoNewClaims() public {
        _approved(LUPE, creator);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        vm.prank(v1);
        vm.expectRevert(CreatorEscrow.StationClosed.selector);
        escrow.approve(LUPE, attacker, CreatorEscrow.Kind.Claim);
        vm.prank(v1);
        vm.expectRevert(CreatorEscrow.StationClosed.selector);
        escrow.cancel(LUPE);
        vm.expectRevert(CreatorEscrow.StationClosed.selector);
        escrow.execute(LUPE);
    }

    function test_aBlockedCreatorWalletCanBeReplacedByANewClaim() public {
        _deposit(LUPE, 50 * USD);
        _approved(LUPE, creator);
        vm.warp(block.timestamp + 72 hours);
        usdc.block_(creator, true);
        vm.expectRevert();
        escrow.execute(LUPE);
        address newWallet = makeAddr("creator's new wallet");
        vm.prank(v1);
        escrow.cancel(LUPE);
        _approved(LUPE, newWallet);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(newWallet), 50 * USD);
    }

    // ---- Unclaimed ---------------------------------------------------------------

    function test_unclaimedGoesToTheCreatorFundContract() public {
        _deposit(LUPE, 900 * USD);
        vm.warp(block.timestamp + THREE_YEARS - 1);
        vm.expectRevert(CreatorEscrow.StillClaimable.selector);
        escrow.releaseToFund(LUPE);
        vm.warp(block.timestamp + 1);
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Paid(LUPE, address(fund), 900 * USD, CreatorEscrow.Reason.Unclaimed);
        vm.prank(attacker);
        escrow.releaseToFund(LUPE);
        assertEq(fund.balance(), 900 * USD);

        _deposit(LUPE, 5 * USD);
        assertEq(escrow.forwarded(address(fund)), 5 * USD);
        escrow.flush(address(fund));
        assertEq(fund.balance(), 905 * USD);
        vm.prank(v1);
        vm.expectRevert(CreatorEscrow.StationClosed.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Claim);
        _onlyPaid(address(fund), address(fund));
    }

    function test_aStationThatNeverEarnedIsNotReleased() public {
        vm.warp(block.timestamp + THREE_YEARS * 2);
        vm.expectRevert(CreatorEscrow.StillClaimable.selector);
        escrow.releaseToFund(OTHER);
    }

    function test_anApprovedClaimWaitingOutItsHoursBlocksTheFund() public {
        _deposit(LUPE, 70 * USD);
        vm.warp(block.timestamp + THREE_YEARS);
        _approved(LUPE, creator);
        vm.expectRevert(CreatorEscrow.ClaimWaiting.selector);
        escrow.releaseToFund(LUPE);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(creator), 70 * USD);
    }

    function test_oneKeyAloneCantBlockTheFund() public {
        _deposit(LUPE, 70 * USD);
        vm.warp(block.timestamp + THREE_YEARS);
        _approve(v1, LUPE, attacker, CreatorEscrow.Kind.Claim);
        escrow.releaseToFund(LUPE);
        assertEq(fund.balance(), 70 * USD);
    }

    // ---- Every other way out fails -------------------------------------------------

    function test_nonVerifiersCantApproveOrCancel() public {
        _deposit(LUPE, 100 * USD);
        vm.startPrank(attacker);
        vm.expectRevert(ThresholdApprovals.NotAKey.selector);
        escrow.approve(LUPE, attacker, CreatorEscrow.Kind.Claim);
        vm.expectRevert(ThresholdApprovals.NotAKey.selector);
        escrow.cancel(LUPE);
        vm.stopPrank();
        vm.prank(safe); // not even Opencast's admin
        vm.expectRevert(ThresholdApprovals.NotAKey.selector);
        escrow.approve(LUPE, safe, CreatorEscrow.Kind.Claim);
    }

    function test_verifiersCantPayThemselvesTheFundOrTheContract() public {
        address[6] memory bad = [v1, v2, address(fund), address(escrow), address(0), address(0)];
        vm.startPrank(v1);
        for (uint256 i; i < 5; ++i) {
            vm.expectRevert(CreatorEscrow.BadClaim.selector);
            escrow.approve(LUPE, bad[i], CreatorEscrow.Kind.Claim);
        }
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.None);
        vm.stopPrank();
    }

    function test_flushOnlyPaysWhatsOwed() public {
        _deposit(LUPE, 100 * USD);
        address[4] memory nobody = [attacker, opencast, address(fund), safe];
        for (uint256 i; i < nobody.length; ++i) {
            vm.expectRevert(CreatorEscrow.NothingOwed.selector);
            escrow.flush(nobody[i]);
        }
    }

    function test_executeHasNoOneToPayWithoutAnApprovedClaim() public {
        _deposit(LUPE, 100 * USD);
        vm.prank(attacker);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        escrow.execute(LUPE);
    }

    function test_aClaimOnOneStationCantTouchAnother() public {
        _deposit(LUPE, 100 * USD);
        _deposit(OTHER, 300 * USD);
        _approved(LUPE, creator);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(creator), 100 * USD);
        assertEq(escrow.balanceOf(OTHER), 300 * USD);
    }

    /// The contract's whole external surface. A function added later fails this test until someone looks at it.
    function test_theOnlyFunctionsAreThese() public view {
        string[31] memory list = [
            // Money
            "deposit(uint256,uint256)",
            "depositBatch(uint256[],uint256[])",
            "approve(uint256,address,uint8)",
            "cancel(uint256)",
            "execute(uint256)",
            "releaseToFund(uint256)",
            "flush(address)",
            // Admin: rotate keys, upgrade (through the timelock)
            "setVerifiers(address[],uint256)",
            "upgradeToAndCall(address,bytes)",
            "initialize(address,address,address[],uint256,uint256,address)",
            // Roles (OpenZeppelin AccessControl)
            "DEFAULT_ADMIN_ROLE()",
            "getRoleAdmin(bytes32)",
            "grantRole(bytes32,address)",
            "hasRole(bytes32,address)",
            "renounceRole(bytes32,address)",
            "revokeRole(bytes32,address)",
            "supportsInterface(bytes4)",
            // Views
            "UPGRADE_INTERFACE_VERSION()",
            "proxiableUUID()",
            "WAITING_PERIOD()",
            "MAX_KEYS()",
            "isKey(address)",
            "keys()",
            "threshold()",
            "proposal(uint256)",
            "usdc()",
            "creatorFund()",
            "unclaimedPeriod()",
            "totalHeld()",
            "forwarded(address)",
            "balanceOf(uint256)"
        ];
        string[] memory allowed = new string[](list.length + 2);
        for (uint256 i; i < list.length; ++i) {
            allowed[i] = list[i];
        }
        allowed[list.length] = "station(uint256)";
        allowed[list.length + 1] = "claimOf(uint256)";
        _onlyTheseFunctions("out/CreatorEscrow.sol/CreatorEscrow.json", allowed);
    }

    // ---- Admin: keys and upgrades, only through the timelock ------------------------

    function test_noOneCanUpgradeOrGrantRolesExceptTheTimelock() public {
        address next = address(new CreatorEscrowV2());
        address[4] memory callers = [attacker, safe, v1, opencast];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], bytes32(0))
            );
            escrow.upgradeToAndCall(next, "");
            vm.prank(callers[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], bytes32(0))
            );
            escrow.grantRole(bytes32(0), callers[i]);
            vm.prank(callers[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], bytes32(0))
            );
            escrow.setVerifiers(_three(attacker, v2, v3), 2);
        }
    }

    function test_anUpgradeIsPublicForAWeekAndAnyVerifierCanStopIt() public {
        address next = address(new CreatorEscrowV2());
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (next, ""));
        vm.prank(safe);
        timelock.schedule(address(escrow), 0, data, bytes32(0), bytes32("u1"), UPGRADE_DELAY);
        vm.warp(block.timestamp + UPGRADE_DELAY - 1);
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), bytes32("u1"));

        bytes32 id = timelock.hashOperation(address(escrow), 0, data, bytes32(0), bytes32("u1"));
        vm.prank(v3);
        timelock.cancel(id);
        vm.warp(block.timestamp + 1);
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), bytes32("u1"));
    }

    function test_anUpgradeKeepsEveryBalanceAndClaim() public {
        _deposit(LUPE, 250 * USD);
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        _throughTimelock(
            address(escrow), abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(new CreatorEscrowV2()), ""))
        );
        assertEq(CreatorEscrowV2(address(escrow)).version(), 2);
        assertEq(escrow.balanceOf(LUPE), 250 * USD);
        assertEq(escrow.totalHeld(), 250 * USD);
        (uint256 approvals,) = _approvals(LUPE);
        assertEq(approvals, 1);
        _approve(v2, LUPE, creator, CreatorEscrow.Kind.Claim);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(creator), 250 * USD);
    }

    function test_rotatingVerifiersVoidsClaimsInProgress() public {
        _deposit(LUPE, 60 * USD);
        _approved(LUPE, creator);
        address v4 = makeAddr("verifier 4");
        _throughTimelock(address(escrow), abi.encodeCall(CreatorEscrow.setVerifiers, (_three(v2, v3, v4), 2)));
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        escrow.execute(LUPE);
        vm.prank(v1);
        vm.expectRevert(ThresholdApprovals.NotAKey.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Claim);
        _approve(v3, LUPE, creator, CreatorEscrow.Kind.Claim);
        _approve(v4, LUPE, creator, CreatorEscrow.Kind.Claim);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(creator), 60 * USD);
    }

    /// OpenZeppelin's checker: the implementation is upgrade-safe, and V2's storage layout is compatible.
    function test_upgradeSafetyCheckedByOpenZeppelin() public {
        Options memory opts;
        Upgrades.validateImplementation("CreatorEscrow.sol", opts);
        opts.referenceContract = "CreatorEscrow.sol";
        Upgrades.validateUpgrade("CreatorEscrowV2.sol", opts);
    }

    // ---- Fuzz --------------------------------------------------------------------

    function testFuzz_depositsAddUp(uint96 a, uint96 b, uint256 id) public {
        vm.assume(a > 0 && b > 0);
        usdc.mint(opencast, uint256(a) + b);
        _deposit(id, a);
        _deposit(id, b);
        assertEq(escrow.balanceOf(id), uint256(a) + b);
        assertEq(escrow.totalHeld(), uint256(a) + b);
    }

    function testFuzz_noClaimPaysBeforeItsWait(uint256 wait, address payee) public {
        vm.assume(payee != address(0) && payee != address(escrow) && payee != address(fund) && !escrow.isKey(payee));
        wait = bound(wait, 0, 72 hours - 1);
        _deposit(LUPE, 10 * USD);
        _approved(LUPE, payee);
        vm.warp(block.timestamp + wait);
        vm.expectRevert(ThresholdApprovals.NotReady.selector);
        escrow.execute(LUPE);
    }
}
