// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {CreatorEscrow} from "../src/CreatorEscrow.sol";
import {CreatorFund} from "../src/CreatorFund.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Deployed} from "./Deployed.sol";

/// Calls every money function of the escrow and the fund in random order, as random callers:
/// verifiers, stewards, strangers, Opencast, payees. Records what the threshold approved, and
/// when it could be paid, so the invariants can check every dollar that left.
contract Handler is Test {
    CreatorEscrow public escrow;
    CreatorFund public fund;
    MockUSDC public usdc;
    address public opencast;
    address[] public verifiers;
    address[] public stewards;
    address[] public actors;
    uint256[] public stationIds = [1, 2, 3];

    /// payee => earliest time the escrow may pay them (0: no threshold approval ever).
    mapping(address => uint256) public payableFrom;
    /// grant => earliest time the fund may pay it (0: never approved by the threshold).
    mapping(uint256 => uint256) public grantPayableFrom;
    uint256[] public grantIds;

    uint256 public deposited;
    uint256 public contributed;
    uint256 public executed;
    uint256 public released;
    uint256 public flushed;
    uint256 public grantsPaid;

    constructor(
        CreatorEscrow e,
        CreatorFund f,
        MockUSDC u,
        address opencast_,
        address[] memory verifiers_,
        address[] memory stewards_
    ) {
        (escrow, fund, usdc, opencast, verifiers, stewards) = (e, f, u, opencast_, verifiers_, stewards_);
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
        actors.push(opencast_);
        actors.push(address(f));
        for (uint256 i; i < verifiers_.length; ++i) {
            actors.push(verifiers_[i]);
        }
        for (uint256 i; i < stewards_.length; ++i) {
            actors.push(stewards_[i]);
        }
    }

    function _station(uint256 seed) private view returns (uint256) {
        return stationIds[seed % stationIds.length];
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _noteClaim(uint256 id) private {
        (, uint256 approvals, uint256 readyAt) = escrow.proposal(id);
        (address p,) = escrow.claimOf(id);
        if (approvals != 0 && readyAt != 0 && (payableFrom[p] == 0 || readyAt < payableFrom[p])) {
            payableFrom[p] = readyAt;
        }
    }

    // ---- Escrow ----

    function deposit(uint256 station, uint96 amount) external {
        amount = uint96(bound(amount, 1, 1e12));
        usdc.mint(opencast, amount);
        vm.prank(opencast);
        escrow.deposit(_station(station), amount);
        deposited += amount;
    }

    function approve(uint256 caller, uint256 station, uint256 payeeSeed, bool stop) external {
        uint256 id = _station(station);
        vm.prank(_actor(caller));
        try escrow.approve(id, _actor(payeeSeed), stop ? CreatorEscrow.Kind.Stop : CreatorEscrow.Kind.Claim) {
            _noteClaim(id);
        } catch {}
    }

    /// Two verifiers agreeing on one of two creators (what honest verifiers do), so claims get paid.
    function approveByThreshold(uint256 first, uint256 station, bool secondCreator) external {
        uint256 id = _station(station);
        address payee = secondCreator ? actors[1] : actors[0];
        for (uint256 k; k < 2; ++k) {
            vm.prank(verifiers[(first + k) % verifiers.length]);
            try escrow.approve(id, payee, CreatorEscrow.Kind.Claim) {
                _noteClaim(id);
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

    // ---- Fund ----

    function contribute(uint96 amount) external {
        amount = uint96(bound(amount, 1, 1e12));
        usdc.mint(opencast, amount);
        vm.prank(opencast);
        fund.contribute(amount, bytes32("pool"));
        contributed += amount;
    }

    function proposeGrant(uint256 caller, uint256 to, uint96 amount) external {
        amount = uint96(bound(amount, 1, 1e12));
        address by = caller % 2 == 0 ? stewards[caller % stewards.length] : _actor(caller);
        vm.prank(by);
        try fund.proposeGrant(_actor(to), amount, bytes32(0)) returns (uint256 id) {
            grantIds.push(id);
        } catch {}
    }

    /// Two stewards agreeing on a grant to one of two new stations (what honest stewards do).
    function grantByThreshold(uint256 first, bool secondStation, uint96 amount) external {
        amount = uint96(bound(amount, 1, 1e9));
        vm.prank(stewards[first % stewards.length]);
        uint256 id = fund.proposeGrant(secondStation ? actors[3] : actors[2], amount, bytes32("honest"));
        grantIds.push(id);
        vm.prank(stewards[(first + 1) % stewards.length]);
        fund.approveGrant(id);
        (,, uint256 readyAt) = fund.proposal(id);
        grantPayableFrom[id] = readyAt;
    }

    function approveGrant(uint256 caller, uint256 which) external {
        if (grantIds.length == 0) return;
        uint256 id = grantIds[which % grantIds.length];
        vm.prank(caller % 2 == 0 ? stewards[caller % stewards.length] : _actor(caller));
        try fund.approveGrant(id) {
            (,, uint256 readyAt) = fund.proposal(id);
            if (readyAt != 0 && (grantPayableFrom[id] == 0 || readyAt < grantPayableFrom[id])) {
                grantPayableFrom[id] = readyAt;
            }
        } catch {}
    }

    function cancelGrant(uint256 caller, uint256 which) external {
        if (grantIds.length == 0) return;
        vm.prank(_actor(caller));
        try fund.cancelGrant(grantIds[which % grantIds.length]) {} catch {}
    }

    function executeGrant(uint256 caller, uint256 which) external {
        if (grantIds.length == 0) return;
        vm.prank(_actor(caller));
        try fund.executeGrant(grantIds[which % grantIds.length]) {
            grantsPaid++;
        } catch {}
    }

    function wait(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 400 days));
    }

    function grantCount() external view returns (uint256) {
        return grantIds.length;
    }
}

contract CreatorEscrowInvariants is Deployed {
    Handler handler;

    function setUp() public override {
        super.setUp();
        usdc.watch(address(fund));
        // A shorter unclaimed period, so releases happen within a run.
        escrow = _deployEscrow(365 days);
        usdc.watch(address(escrow));
        handler = new Handler(escrow, fund, usdc, opencast, _three(v1, v2, v3), _three(s1, s2, s3));
        vm.startPrank(opencast);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.approve(address(fund), type(uint256).max);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// The escrow paid only the fund, or a payee the threshold approved, once their 72 hours were up.
    /// The fund paid only grants the threshold approved, after their 72 hours, never to Opencast.
    function invariant_moneyOnlyGoesWhereItsAllowed() public view {
        for (uint256 i; i < usdc.outCount(); ++i) {
            (address from, address to, uint256 amount, uint256 at) = usdc.outs(i);
            if (from == address(escrow)) {
                if (to == address(fund)) continue;
                uint256 fromTime = handler.payableFrom(to);
                assertTrue(fromTime != 0, "escrow paid someone no threshold approved");
                assertGe(at, fromTime, "escrow paid before the 72 hours were up");
            } else {
                assertTrue(to != opencast && to != treasury, "the fund paid Opencast");
                assertFalse(fund.isKey(to), "the fund paid a steward");
                bool matched;
                for (uint256 g; g < handler.grantCount(); ++g) {
                    uint256 id = handler.grantIds(g);
                    CreatorFund.Grant memory gr = fund.grant(id);
                    if (gr.recipient == to && gr.amount == amount && gr.status == CreatorFund.GrantStatus.Paid) {
                        uint256 fromTime = handler.grantPayableFrom(id);
                        if (fromTime != 0 && at >= fromTime) matched = true;
                    }
                }
                assertTrue(matched, "the fund paid something that wasn't an approved grant after its wait");
            }
        }
    }

    /// Everything that came in is held or was paid out; nothing is created or lost.
    function invariant_theBooksBalance() public view {
        uint256 escrowOut;
        uint256 fundOut;
        uint256 escrowToFund;
        for (uint256 i; i < usdc.outCount(); ++i) {
            (address from, address to, uint256 amount,) = usdc.outs(i);
            if (from == address(escrow)) {
                escrowOut += amount;
                if (to == address(fund)) escrowToFund += amount;
            } else {
                fundOut += amount;
            }
        }
        assertEq(handler.deposited(), escrow.totalHeld() + escrowOut);
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalHeld());
        // The fund started with nothing here; it holds what came in less the grants it paid.
        assertEq(fund.balance(), handler.contributed() + escrowToFund - fundOut);
    }

    function afterInvariant() external view {
        console.log("claims paid, releases, flushes:", handler.executed(), handler.released(), handler.flushed());
        console.log("grants proposed, grants paid:", handler.grantCount(), handler.grantsPaid());
    }
}
