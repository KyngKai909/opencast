// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CreatorEscrow, IERC20} from "../src/CreatorEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CreatorEscrowTest is Test {
    MockUSDC usdc;
    CreatorEscrow escrow;

    address opencast = makeAddr("opencast settlement wallet");
    address fund = makeAddr("creator fund");
    address v1 = makeAddr("verifier 1");
    address v2 = makeAddr("verifier 2");
    address v3 = makeAddr("verifier 3");
    address creator = makeAddr("creator (Tia Lupe)");
    address attacker = makeAddr("attacker");

    uint256 constant LUPE = 33; // a station's escrow ID
    uint256 constant OTHER = 101;
    uint256 constant THREE_YEARS = 1095 days;
    uint256 constant USD = 1e6;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        address[] memory verifiers = new address[](3);
        verifiers[0] = v1;
        verifiers[1] = v2;
        verifiers[2] = v3;
        escrow = new CreatorEscrow(IERC20(address(usdc)), fund, verifiers, 2, THREE_YEARS);
        usdc.watch(address(escrow));
        usdc.mint(opencast, 1_000_000 * USD);
        vm.prank(opencast);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _deposit(uint256 station, uint256 amount) internal {
        vm.prank(opencast);
        escrow.deposit(station, amount);
    }

    function _approve(address verifier, uint256 station, address payee, CreatorEscrow.Kind kind) internal {
        vm.prank(verifier);
        escrow.approve(station, payee, kind);
    }

    function _approved(uint256 station, address payee) internal {
        _approve(v1, station, payee, CreatorEscrow.Kind.Claim);
        _approve(v2, station, payee, CreatorEscrow.Kind.Claim);
    }

    /// Nothing ever left the escrow for anyone but these two.
    function _onlyPaid(address a, address b) internal view {
        for (uint256 i; i < usdc.outCount(); ++i) {
            (address to,,) = usdc.outs(i);
            assertTrue(to == a || to == b, "money went somewhere else");
        }
    }

    // ---- Setup -------------------------------------------------------------------

    function test_setupNeedsAMultisigAndAFund() public {
        address[] memory one = new address[](1);
        one[0] = v1;
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        new CreatorEscrow(IERC20(address(usdc)), fund, one, 1, THREE_YEARS);

        address[] memory two = new address[](2);
        two[0] = v1;
        two[1] = v1;
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        new CreatorEscrow(IERC20(address(usdc)), fund, two, 2, THREE_YEARS);

        two[1] = fund;
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        new CreatorEscrow(IERC20(address(usdc)), fund, two, 2, THREE_YEARS);

        two[1] = v2;
        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        new CreatorEscrow(IERC20(address(usdc)), address(0), two, 2, THREE_YEARS);

        vm.expectRevert(CreatorEscrow.BadSetup.selector);
        new CreatorEscrow(IERC20(address(usdc)), fund, two, 3, THREE_YEARS);
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
        (, uint64 firstDepositAt,,) = escrow.stations(LUPE);
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
        vm.expectRevert(CreatorEscrow.TransferFailed.selector);
        escrow.deposit(LUPE, 1 * USD);
    }

    // ---- Claim -------------------------------------------------------------------

    function test_claimPaysTheCreatorAfterApprovalAnd72Hours() public {
        _deposit(LUPE, 500 * USD);
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        (,, uint8 approvals, uint64 readyAt,) = escrow.pending(LUPE);
        assertEq(approvals, 1);
        assertEq(readyAt, 0, "one key isn't enough");

        vm.expectEmit(address(escrow));
        emit CreatorEscrow.ClaimReady(LUPE, creator, CreatorEscrow.Kind.Claim, block.timestamp + 72 hours);
        _approve(v2, LUPE, creator, CreatorEscrow.Kind.Claim);

        vm.warp(block.timestamp + 72 hours - 1);
        vm.expectRevert(CreatorEscrow.NotReady.selector);
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
        vm.expectRevert(CreatorEscrow.DifferentClaim.selector);
        escrow.approve(LUPE, attacker, CreatorEscrow.Kind.Claim);
        vm.prank(v2);
        vm.expectRevert(CreatorEscrow.DifferentClaim.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Stop);
        vm.prank(v1);
        vm.expectRevert(CreatorEscrow.AlreadyApproved.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Claim);
    }

    function test_anyOneVerifierCanCancelDuringTheWait() public {
        _deposit(LUPE, 500 * USD);
        _approved(LUPE, attacker); // two keys compromised
        vm.warp(block.timestamp + 24 hours);
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.ClaimCancelled(LUPE, v3, 1);
        vm.prank(v3); // the honest one sees it in public and stops it
        escrow.cancel(LUPE);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(CreatorEscrow.NotReady.selector);
        escrow.execute(LUPE);
        assertEq(escrow.balanceOf(LUPE), 500 * USD);

        // Approvals from before the cancel don't count again.
        _approve(v1, LUPE, creator, CreatorEscrow.Kind.Claim);
        (,, uint8 approvals,,) = escrow.pending(LUPE);
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
        (,, CreatorEscrow.Status status, address payee) = escrow.stations(LUPE);
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
        vm.expectRevert(CreatorEscrow.TransferFailed.selector);
        escrow.execute(LUPE);
        // Nothing changed; the verifiers cancel and approve the creator's new wallet, and wait again.
        address newWallet = makeAddr("creator's new wallet");
        vm.prank(v1);
        escrow.cancel(LUPE);
        _approved(LUPE, newWallet);
        vm.warp(block.timestamp + 72 hours);
        escrow.execute(LUPE);
        assertEq(usdc.balanceOf(newWallet), 50 * USD);
    }

    // ---- Unclaimed ---------------------------------------------------------------

    function test_unclaimedGoesToTheFundAfterThePeriod() public {
        _deposit(LUPE, 900 * USD);
        vm.warp(block.timestamp + THREE_YEARS - 1);
        vm.expectRevert(CreatorEscrow.StillClaimable.selector);
        escrow.releaseToFund(LUPE);
        vm.warp(block.timestamp + 1);
        vm.expectEmit(address(escrow));
        emit CreatorEscrow.Paid(LUPE, fund, 900 * USD, CreatorEscrow.Reason.Unclaimed);
        vm.prank(attacker);
        escrow.releaseToFund(LUPE);
        assertEq(usdc.balanceOf(fund), 900 * USD);

        // Later deposits follow it; a claim can't reopen it.
        _deposit(LUPE, 5 * USD);
        assertEq(escrow.forwarded(fund), 5 * USD);
        vm.prank(v1);
        vm.expectRevert(CreatorEscrow.StationClosed.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.Claim);
        _onlyPaid(fund, fund);
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
        _approve(v1, LUPE, attacker, CreatorEscrow.Kind.Claim); // below the threshold
        escrow.releaseToFund(LUPE);
        assertEq(usdc.balanceOf(fund), 70 * USD);
    }

    // ---- Every other way out fails -------------------------------------------------

    function test_nonVerifiersCantApproveOrCancel() public {
        _deposit(LUPE, 100 * USD);
        vm.startPrank(attacker);
        vm.expectRevert(CreatorEscrow.NotVerifier.selector);
        escrow.approve(LUPE, attacker, CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.NotVerifier.selector);
        escrow.cancel(LUPE);
        vm.stopPrank();
        vm.prank(opencast);
        vm.expectRevert(CreatorEscrow.NotVerifier.selector);
        escrow.approve(LUPE, opencast, CreatorEscrow.Kind.Claim);
    }

    function test_verifiersCantPayThemselvesTheFundOrTheContract() public {
        vm.startPrank(v1);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, v1, CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, v2, CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, fund, CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, address(escrow), CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, address(0), CreatorEscrow.Kind.Claim);
        vm.expectRevert(CreatorEscrow.BadClaim.selector);
        escrow.approve(LUPE, creator, CreatorEscrow.Kind.None);
        vm.stopPrank();
    }

    function test_flushOnlyPaysWhatsOwed() public {
        _deposit(LUPE, 100 * USD);
        vm.expectRevert(CreatorEscrow.NothingOwed.selector);
        escrow.flush(attacker);
        vm.expectRevert(CreatorEscrow.NothingOwed.selector);
        escrow.flush(opencast);
        vm.expectRevert(CreatorEscrow.NothingOwed.selector);
        escrow.flush(fund); // nothing released yet
    }

    function test_executeHasNoOneToPayWithoutAnApprovedClaim() public {
        _deposit(LUPE, 100 * USD);
        vm.prank(attacker);
        vm.expectRevert(CreatorEscrow.NotReady.selector);
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

    /// The contract's whole external surface. A function added later (an owner, a rescue, an
    /// upgrade) fails this test until someone looks at it.
    function test_theOnlyFunctionsAreTheseAndNoneIsAnAdmin() public view {
        string memory json = vm.readFile("out/CreatorEscrow.sol/CreatorEscrow.json");
        string[] memory keys = vm.parseJsonKeys(json, ".methodIdentifiers");
        string[20] memory allowed = [
            "WAITING_PERIOD()",
            "approve(uint256,address,uint8)",
            "balanceOf(uint256)",
            "cancel(uint256)",
            "creatorFund()",
            "deposit(uint256,uint256)",
            "depositBatch(uint256[],uint256[])",
            "execute(uint256)",
            "flush(address)",
            "forwarded(address)",
            "hasApproved(uint256,uint32,address)",
            "isVerifier(address)",
            "pending(uint256)",
            "releaseToFund(uint256)",
            "stations(uint256)",
            "threshold()",
            "totalHeld()",
            "unclaimedPeriod()",
            "usdc()",
            "verifierCount()"
        ];
        assertEq(keys.length, allowed.length, "the contract's functions changed");
        for (uint256 i; i < keys.length; ++i) {
            bool found;
            for (uint256 j; j < allowed.length; ++j) {
                if (keccak256(bytes(keys[i])) == keccak256(bytes(allowed[j]))) found = true;
            }
            assertTrue(found, keys[i]);
        }
        // No delegatecall or selfdestruct anywhere in the deployed code: nothing can swap its logic.
        bytes memory code = address(escrow).code;
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f; // skip PUSH data
                continue;
            }
            assertTrue(op != 0xf4, "DELEGATECALL");
            assertTrue(op != 0xff, "SELFDESTRUCT");
        }
    }

    // ---- Fuzz --------------------------------------------------------------------

    function testFuzz_depositsAddUp(uint96 a, uint96 b, uint256 station) public {
        vm.assume(a > 0 && b > 0);
        usdc.mint(opencast, uint256(a) + b);
        _deposit(station, a);
        _deposit(station, b);
        assertEq(escrow.balanceOf(station), uint256(a) + b);
        assertEq(escrow.totalHeld(), uint256(a) + b);
    }

    function testFuzz_noClaimPaysBeforeItsWait(uint256 wait, address payee) public {
        vm.assume(payee != address(0) && payee != address(escrow) && payee != fund && !escrow.isVerifier(payee));
        wait = bound(wait, 0, 72 hours - 1);
        _deposit(LUPE, 10 * USD);
        _approved(LUPE, payee);
        vm.warp(block.timestamp + wait);
        vm.expectRevert(CreatorEscrow.NotReady.selector);
        escrow.execute(LUPE);
    }
}
