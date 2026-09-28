// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {CreatorEscrow, IERC20} from "../src/CreatorEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Calls every function in random order, as random callers: verifiers (honest or not), strangers,
/// Opencast, payees. Records which payees were approved by the threshold, and when they could be paid.
contract Handler is Test {
    CreatorEscrow public escrow;
    MockUSDC public usdc;
    address public fund;
    address public opencast;
    address[] public verifiers;
    address[] public actors;
    uint256[] public stationIds = [1, 2, 3];

    /// payee => the earliest time the escrow may pay them (0: never approved by the threshold).
    mapping(address => uint256) public payableFrom;
    /// Sum of every deposit, for the accounting invariant.
    uint256 public deposited;
    /// How often each way out succeeded: the invariants only mean something if money moves.
    uint256 public executed;
    uint256 public released;
    uint256 public flushed;

    constructor(CreatorEscrow escrow_, MockUSDC usdc_, address fund_, address opencast_, address[] memory verifiers_) {
        escrow = escrow_;
        usdc = usdc_;
        fund = fund_;
        opencast = opencast_;
        verifiers = verifiers_;
        for (uint256 i; i < 5; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
        actors.push(opencast_);
        actors.push(fund_);
        for (uint256 i; i < verifiers_.length; ++i) {
            actors.push(verifiers_[i]);
        }
    }

    function _station(uint256 seed) private view returns (uint256) {
        return stationIds[seed % stationIds.length];
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 station, uint96 amount) external {
        amount = uint96(bound(amount, 1, 1e12));
        usdc.mint(opencast, amount);
        vm.prank(opencast);
        escrow.deposit(_station(station), amount);
        deposited += amount;
    }

    function approve(uint256 caller, uint256 station, uint256 payeeSeed, bool stop) external {
        address who = _actor(caller);
        address payee = _actor(payeeSeed);
        uint256 id = _station(station);
        vm.prank(who);
        try escrow.approve(id, payee, stop ? CreatorEscrow.Kind.Stop : CreatorEscrow.Kind.Claim) {
            (address p,,, uint64 readyAt,) = escrow.pending(id);
            if (readyAt != 0 && (payableFrom[p] == 0 || readyAt < payableFrom[p])) payableFrom[p] = readyAt;
        } catch {}
    }

    /// Two verifiers agreeing on one of two creators (what honest verifiers do), so claims get paid.
    function approveByThreshold(uint256 first, uint256 station, bool secondCreator) external {
        uint256 id = _station(station);
        address payee = secondCreator ? actors[1] : actors[0];
        for (uint256 k; k < 2; ++k) {
            vm.prank(verifiers[(first + k) % verifiers.length]);
            try escrow.approve(id, payee, CreatorEscrow.Kind.Claim) {
                (address p,,, uint64 readyAt,) = escrow.pending(id);
                if (readyAt != 0 && (payableFrom[p] == 0 || readyAt < payableFrom[p])) payableFrom[p] = readyAt;
            } catch {}
        }
    }

    function cancel(uint256 caller, uint256 station) external {
        vm.prank(_actor(caller));
        try escrow.cancel(_station(station)) {} catch {}
    }

    function execute(uint256 caller, uint256 station) external {
        vm.prank(_actor(caller));
        try escrow.execute(_station(station)) {
            executed++;
        } catch {}
    }

    function releaseToFund(uint256 caller, uint256 station) external {
        vm.prank(_actor(caller));
        try escrow.releaseToFund(_station(station)) {
            released++;
        } catch {}
    }

    function flush(uint256 caller, uint256 to) external {
        vm.prank(_actor(caller));
        try escrow.flush(_actor(to)) {
            flushed++;
        } catch {}
    }

    function wait(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 400 days));
    }
}

contract CreatorEscrowInvariants is Test {
    CreatorEscrow escrow;
    MockUSDC usdc;
    Handler handler;
    address fund = makeAddr("creator fund");

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        address[] memory verifiers = new address[](3);
        verifiers[0] = makeAddr("v1");
        verifiers[1] = makeAddr("v2");
        verifiers[2] = makeAddr("v3");
        escrow = new CreatorEscrow(IERC20(address(usdc)), fund, verifiers, 2, 365 days);
        usdc.watch(address(escrow));
        address opencast = makeAddr("opencast");
        handler = new Handler(escrow, usdc, fund, opencast, verifiers);
        vm.prank(opencast);
        usdc.approve(address(escrow), type(uint256).max);
        targetContract(address(handler));
    }

    /// Money only ever left to the fund, or to a payee the threshold approved, once their wait was over.
    function invariant_onlyTheCreatorOrTheFundIsEverPaid() public view {
        for (uint256 i; i < usdc.outCount(); ++i) {
            (address to,, uint256 at) = usdc.outs(i);
            if (to == fund) continue;
            uint256 from = handler.payableFrom(to);
            assertTrue(from != 0, "paid someone no threshold approved");
            assertGe(at, from, "paid before the 72 hours were up");
        }
    }

    function afterInvariant() external view {
        console.log(
            "paid claims/stops, releases to fund, flushes:", handler.executed(), handler.released(), handler.flushed()
        );
    }

    /// Everything that came in is either still held or was paid out; nothing is created or lost.
    function invariant_theBooksBalance() public view {
        uint256 paidOut;
        for (uint256 i; i < usdc.outCount(); ++i) {
            (, uint256 amount,) = usdc.outs(i);
            paidOut += amount;
        }
        assertEq(handler.deposited(), escrow.totalHeld() + paidOut);
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalHeld());
        uint256 stations;
        for (uint256 i = 1; i <= 3; ++i) {
            stations += escrow.balanceOf(i);
        }
        assertLe(stations, escrow.totalHeld());
    }
}
