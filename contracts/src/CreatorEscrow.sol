// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ThresholdApprovals} from "./ThresholdApprovals.sol";

/// @title CreatorEscrow
/// @notice Holds the earnings of claimable stations (stations Opencast runs for a creator until
/// they claim it) in USDC, each under the station's escrow ID. Money leaves in exactly three
/// ways, and only to two kinds of address:
///
/// - Claim: the creator's wallet, once `threshold` verifiers approve the same claim and 72 hours
///   pass in public, during which any one verifier can cancel it. Later deposits follow.
/// - Stop: the same path, when the creator asks for the station to be signed off.
/// - Unclaimed: after `unclaimedPeriod` from the station's first deposit with no claim, anyone
///   can send the balance to the creator fund. Later deposits follow it.
///
/// Upgradeable (UUPS), like Opencast's and Clear's other contracts. The admin role can do two
/// things only: change the verifier keys, and authorize an upgrade. It's meant to be held by a
/// TimelockController with a 7-day delay that the verifiers can cancel, so any change is public
/// for a week first. No function takes a destination address except `flush`, which can only pay
/// what's already owed to it.
contract CreatorEscrow is AccessControlUpgradeable, UUPSUpgradeable, ThresholdApprovals {
    using SafeERC20 for IERC20;

    enum Kind {
        None,
        Claim,
        Stop
    }

    enum Status {
        Open,
        Claimed,
        Stopped,
        Unclaimed
    }

    enum Reason {
        Claim,
        Stop,
        Unclaimed
    }

    struct Station {
        uint128 balance;
        uint64 firstDepositAt;
        Status status;
        /// The creator's wallet once claimed or stopped; the fund once released.
        address payee;
    }

    struct Claim {
        address payee;
        Kind kind;
    }

    /// @custom:storage-location erc7201:opencast.storage.CreatorEscrow
    struct EscrowStorage {
        IERC20 usdc;
        address creatorFund;
        uint256 unclaimedPeriod;
        mapping(uint256 => Station) stations;
        mapping(uint256 => Claim) claims;
        /// Deposits after a station closed: owed to its creator, or the fund.
        mapping(address => uint256) forwarded;
        /// Every station balance plus everything forwarded. The token balance is never less.
        uint256 totalHeld;
    }

    // keccak256(abi.encode(uint256(keccak256("opencast.storage.CreatorEscrow")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE = 0x1193c208ef3dd069ed3bbd83197b23b658ebd11270f2e7724eb755e36b66c600;

    event Deposited(uint256 indexed stationId, uint256 amount, address indexed forwardedTo);
    event ClaimProposed(uint256 indexed stationId, address payee, Kind kind);
    event Paid(uint256 indexed stationId, address indexed to, uint256 amount, Reason reason);
    event Flushed(address indexed to, uint256 amount);

    error BadSetup();
    error StationClosed();
    error BadClaim();
    error StillClaimable();
    error ClaimWaiting();
    error NothingOwed();
    error ZeroAmount();
    error LengthMismatch();
    error TooLarge();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 usdc_,
        address creatorFund_,
        address[] calldata verifiers,
        uint256 threshold_,
        uint256 unclaimedPeriod_,
        address admin
    ) external initializer {
        if (address(usdc_) == address(0) || creatorFund_ == address(0) || admin == address(0)) {
            revert BadSetup();
        }
        if (unclaimedPeriod_ < WAITING_PERIOD) revert BadSetup();
        EscrowStorage storage $ = _escrow();
        $.usdc = usdc_;
        $.creatorFund = creatorFund_;
        $.unclaimedPeriod = unclaimedPeriod_;
        __AccessControl_init();
        __ThresholdApprovals_init(verifiers, threshold_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---- In ----------------------------------------------------------------------

    /// @notice Deposits a station's earnings, pulled from the caller (Opencast's settlement wallet).
    function deposit(uint256 stationId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // Books first, then the transfer in; if it fails, the whole call reverts.
        _credit(stationId, amount);
        _escrow().usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice The weekly batch: credited to each station, one transfer in.
    function depositBatch(uint256[] calldata stationIds, uint256[] calldata amounts) external {
        if (stationIds.length != amounts.length) revert LengthMismatch();
        uint256 total = 0;
        for (uint256 i; i < stationIds.length; ++i) {
            // A zero in the batch is a mistake upstream: refuse the whole batch.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (amounts[i] == 0) revert ZeroAmount();
            total += amounts[i];
            _credit(stationIds[i], amounts[i]);
        }
        _escrow().usdc.safeTransferFrom(msg.sender, address(this), total);
    }

    // ---- Claim and Stop ----------------------------------------------------------

    /// @notice A verifier approves paying the station to `payee`. Every approval in a round must
    /// name the same payee and kind. At the threshold the 72-hour wait starts.
    function approve(uint256 stationId, address payee, Kind kind) external {
        EscrowStorage storage $ = _escrow();
        if ($.stations[stationId].status != Status.Open) revert StationClosed();
        if (payee == address(0) || payee == address(this) || isKey(payee) || payee == $.creatorFund) revert BadClaim();
        if (kind != Kind.Claim && kind != Kind.Stop) revert BadClaim();
        (, uint256 before,) = proposal(stationId);
        _approve(stationId, keccak256(abi.encode(payee, kind)));
        if (before == 0) {
            $.claims[stationId] = Claim(payee, kind);
            emit ClaimProposed(stationId, payee, kind);
        }
    }

    /// @notice Any one verifier can cancel a claim at any time before it's paid.
    function cancel(uint256 stationId) external {
        if (_escrow().stations[stationId].status != Status.Open) revert StationClosed();
        _cancel(stationId);
    }

    /// @notice After the wait, anyone can pay an approved claim. It pays the approved payee only.
    function execute(uint256 stationId) external {
        EscrowStorage storage $ = _escrow();
        Station storage s = $.stations[stationId];
        if (s.status != Status.Open) revert StationClosed();
        bytes32 subject = _consume(stationId);
        Claim memory c = $.claims[stationId];
        // The terms stored with the first approval are the ones every key approved.
        if (keccak256(abi.encode(c.payee, c.kind)) != subject) revert BadClaim();
        delete $.claims[stationId];

        uint256 amount = s.balance;
        s.balance = 0;
        s.status = c.kind == Kind.Claim ? Status.Claimed : Status.Stopped;
        s.payee = c.payee;
        $.totalHeld -= amount;

        emit Paid(stationId, c.payee, amount, c.kind == Kind.Claim ? Reason.Claim : Reason.Stop);
        if (amount != 0) $.usdc.safeTransfer(c.payee, amount);
    }

    // ---- Unclaimed ---------------------------------------------------------------

    /// @notice After the unclaimed period with no claim, anyone can send the balance to the creator
    /// fund. Not while an approved claim is waiting out its 72 hours.
    function releaseToFund(uint256 stationId) external {
        EscrowStorage storage $ = _escrow();
        Station storage s = $.stations[stationId];
        if (s.status != Status.Open) revert StationClosed();
        // forge-lint: disable-next-line(block-timestamp)
        if (s.firstDepositAt == 0 || block.timestamp < uint256(s.firstDepositAt) + $.unclaimedPeriod) {
            revert StillClaimable();
        }
        if (_isWaiting(stationId)) revert ClaimWaiting();
        _clear(stationId);
        delete $.claims[stationId];

        uint256 amount = s.balance;
        address fund = $.creatorFund;
        s.balance = 0;
        s.status = Status.Unclaimed;
        s.payee = fund;
        $.totalHeld -= amount;

        emit Paid(stationId, fund, amount, Reason.Unclaimed);
        if (amount != 0) $.usdc.safeTransfer(fund, amount);
    }

    /// @notice Pays out deposits that arrived after a station closed. Anyone can call it; it only
    /// pays an address money is already owed to (a claimed station's creator, or the fund).
    function flush(address to) external {
        EscrowStorage storage $ = _escrow();
        uint256 amount = $.forwarded[to];
        if (amount == 0) revert NothingOwed();
        $.forwarded[to] = 0;
        $.totalHeld -= amount;
        emit Flushed(to, amount);
        $.usdc.safeTransfer(to, amount);
    }

    // ---- Admin (through the timelock) ----------------------------------------------

    /// @notice Replaces the verifier keys. Every claim in progress starts again.
    function setVerifiers(address[] calldata verifiers, uint256 threshold_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setKeys(verifiers, threshold_);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _mayHoldKey(address k) internal view override returns (bool) {
        return k != _escrow().creatorFund && k != address(this);
    }

    // ---- Views -------------------------------------------------------------------

    function usdc() external view returns (IERC20) {
        return _escrow().usdc;
    }

    function creatorFund() external view returns (address) {
        return _escrow().creatorFund;
    }

    function unclaimedPeriod() external view returns (uint256) {
        return _escrow().unclaimedPeriod;
    }

    function totalHeld() external view returns (uint256) {
        return _escrow().totalHeld;
    }

    function forwarded(address to) external view returns (uint256) {
        return _escrow().forwarded[to];
    }

    function balanceOf(uint256 stationId) external view returns (uint256) {
        return _escrow().stations[stationId].balance;
    }

    function station(uint256 stationId)
        external
        view
        returns (uint256 balance, uint256 firstDepositAt, Status status, address payee)
    {
        Station storage s = _escrow().stations[stationId];
        return (s.balance, s.firstDepositAt, s.status, s.payee);
    }

    /// The claim in progress: who it would pay, and how. Approvals and timing are in `proposal`.
    function claimOf(uint256 stationId) external view returns (address payee, Kind kind) {
        (, uint256 approvals,) = proposal(stationId);
        if (approvals == 0) return (address(0), Kind.None);
        Claim storage c = _escrow().claims[stationId];
        return (c.payee, c.kind);
    }

    // ---- Internal ----------------------------------------------------------------

    function _escrow() private pure returns (EscrowStorage storage $) {
        assembly {
            $.slot := STORAGE
        }
    }

    function _credit(uint256 stationId, uint256 amount) private {
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (amount > type(uint128).max) revert TooLarge();
        EscrowStorage storage $ = _escrow();
        Station storage s = $.stations[stationId];
        $.totalHeld += amount;
        if (s.status == Status.Open) {
            // casting to 'uint64' is safe because timestamps fit in 64 bits for billions of years
            // forge-lint: disable-next-line(unsafe-typecast)
            if (s.firstDepositAt == 0) s.firstDepositAt = uint64(block.timestamp);
            // casting to 'uint128' is safe because amounts above type(uint128).max revert above
            // forge-lint: disable-next-line(unsafe-typecast)
            s.balance += uint128(amount);
            emit Deposited(stationId, amount, address(0));
        } else {
            // Claimed or stopped: the creator's. Released as unclaimed: the fund's.
            $.forwarded[s.payee] += amount;
            emit Deposited(stationId, amount, s.payee);
        }
    }
}
