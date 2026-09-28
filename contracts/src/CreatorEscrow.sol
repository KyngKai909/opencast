// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The two ERC-20 calls the escrow makes, on USDC.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title CreatorEscrow
/// @notice Holds the earnings of claimable stations (stations Opencast runs for a creator
/// until they claim it) in USDC, each under the station's escrow ID. Money leaves in exactly
/// three ways, and only to two kinds of address:
///
/// - Claim: the creator's wallet, once `threshold` verifiers approve the same claim and 72 hours
///   pass in public, during which any one verifier can cancel it. Later deposits for the station
///   go to that wallet too.
/// - Stop: the same path, when the creator asks for the station to be signed off.
/// - Unclaimed: after `unclaimedPeriod` from the station's first deposit with no claim, anyone
///   can send the balance to the creator fund, fixed at deployment. Later deposits follow it.
///
/// There is no owner, no admin, no pause and no upgrade path: the verifier set, the threshold,
/// the fund, the token and the unclaimed period are fixed when it's deployed, and no function
/// takes a destination address except `flush`, which can only pay what's already owed to it.
contract CreatorEscrow {
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
        /// The creator's wallet once claimed or stopped.
        address payee;
    }

    struct Pending {
        address payee;
        Kind kind;
        uint8 approvals;
        /// When it can be paid: zero until `threshold` verifiers have approved it.
        uint64 readyAt;
        /// Bumped on every cancel, so earlier approvals no longer count.
        uint32 round;
    }

    uint256 public constant WAITING_PERIOD = 72 hours;

    IERC20 public immutable usdc;
    address public immutable creatorFund;
    uint256 public immutable unclaimedPeriod;
    uint256 public immutable threshold;
    uint256 public immutable verifierCount;

    /// Written in the constructor only.
    mapping(address => bool) public isVerifier;

    mapping(uint256 => Station) public stations;
    mapping(uint256 => Pending) public pending;
    mapping(uint256 => mapping(uint32 => mapping(address => bool))) public hasApproved;
    /// Deposits that arrived after a station was claimed, stopped or released: owed to its payee or the fund.
    mapping(address => uint256) public forwarded;
    /// Every station balance plus everything forwarded. The token balance is never less.
    uint256 public totalHeld;

    event Deposited(uint256 indexed stationId, uint256 amount, address indexed forwardedTo);
    event ClaimApproval(
        uint256 indexed stationId, address indexed verifier, address payee, Kind kind, uint256 approvals
    );
    event ClaimReady(uint256 indexed stationId, address payee, Kind kind, uint256 readyAt);
    event ClaimCancelled(uint256 indexed stationId, address indexed verifier, uint32 round);
    event Paid(uint256 indexed stationId, address indexed to, uint256 amount, Reason reason);
    event Flushed(address indexed to, uint256 amount);

    error BadSetup();
    error NotVerifier();
    error StationClosed();
    error BadClaim();
    error DifferentClaim();
    error AlreadyApproved();
    error NothingPending();
    error NotReady();
    error StillClaimable();
    error ClaimWaiting();
    error NothingOwed();
    error ZeroAmount();
    error LengthMismatch();
    error TooLarge();
    error TransferFailed();

    constructor(
        IERC20 usdc_,
        address creatorFund_,
        address[] memory verifiers,
        uint256 threshold_,
        uint256 unclaimedPeriod_
    ) {
        if (address(usdc_) == address(0) || creatorFund_ == address(0)) revert BadSetup();
        // A multi-signature: at least two keys must agree, and there must be keys enough to reach it.
        if (threshold_ < 2 || threshold_ > verifiers.length || verifiers.length > 32) revert BadSetup();
        if (unclaimedPeriod_ < WAITING_PERIOD) revert BadSetup();
        for (uint256 i; i < verifiers.length; ++i) {
            address v = verifiers[i];
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (v == address(0) || v == creatorFund_ || isVerifier[v]) revert BadSetup();
            isVerifier[v] = true;
        }
        usdc = usdc_;
        creatorFund = creatorFund_;
        threshold = threshold_;
        verifierCount = verifiers.length;
        unclaimedPeriod = unclaimedPeriod_;
    }

    // ---- In ----------------------------------------------------------------------

    /// @notice Deposits a station's earnings, pulled from the caller (Opencast's settlement wallet).
    function deposit(uint256 stationId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // Books first, then the transfer in; if it fails, the whole call reverts.
        _credit(stationId, amount);
        _pull(amount);
    }

    /// @notice The weekly batch: one transfer in, credited to each station.
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
        _pull(total);
    }

    // ---- Claim and Stop ----------------------------------------------------------

    /// @notice A verifier approves paying the station to `payee`. Every approval in a round must
    /// name the same payee and kind. At `threshold` approvals the 72-hour wait starts.
    function approve(uint256 stationId, address payee, Kind kind) external {
        if (!isVerifier[msg.sender]) revert NotVerifier();
        Station storage s = stations[stationId];
        if (s.status != Status.Open) revert StationClosed();
        if (payee == address(0) || payee == address(this) || isVerifier[payee] || payee == creatorFund) {
            revert BadClaim();
        }
        if (kind != Kind.Claim && kind != Kind.Stop) revert BadClaim();

        Pending storage p = pending[stationId];
        if (p.readyAt != 0) revert AlreadyApproved();
        if (p.approvals == 0) {
            p.payee = payee;
            p.kind = kind;
        } else if (p.payee != payee || p.kind != kind) {
            revert DifferentClaim();
        }
        if (hasApproved[stationId][p.round][msg.sender]) revert AlreadyApproved();
        hasApproved[stationId][p.round][msg.sender] = true;
        uint8 approvals = ++p.approvals;
        emit ClaimApproval(stationId, msg.sender, payee, kind, approvals);

        if (approvals == threshold) {
            // casting to 'uint64' is safe because timestamps fit in 64 bits for billions of years
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64 readyAt = uint64(block.timestamp + WAITING_PERIOD);
            p.readyAt = readyAt;
            emit ClaimReady(stationId, payee, kind, readyAt);
        }
    }

    /// @notice Any one verifier can cancel a claim at any time before it's paid.
    function cancel(uint256 stationId) external {
        if (!isVerifier[msg.sender]) revert NotVerifier();
        if (stations[stationId].status != Status.Open) revert StationClosed();
        Pending storage p = pending[stationId];
        if (p.approvals == 0) revert NothingPending();
        uint32 round = p.round + 1;
        pending[stationId] = Pending({payee: address(0), kind: Kind.None, approvals: 0, readyAt: 0, round: round});
        emit ClaimCancelled(stationId, msg.sender, round);
    }

    /// @notice After the wait, anyone can pay an approved claim. It pays the approved payee only.
    function execute(uint256 stationId) external {
        Station storage s = stations[stationId];
        if (s.status != Status.Open) revert StationClosed();
        Pending memory p = pending[stationId];
        // Windows are 72 hours and years long: a validator's few seconds of drift don't matter.
        // forge-lint: disable-next-line(block-timestamp)
        if (p.readyAt == 0 || block.timestamp < p.readyAt) revert NotReady();

        uint256 amount = s.balance;
        s.balance = 0;
        s.status = p.kind == Kind.Claim ? Status.Claimed : Status.Stopped;
        s.payee = p.payee;
        totalHeld -= amount;
        pending[stationId] = Pending({payee: address(0), kind: Kind.None, approvals: 0, readyAt: 0, round: p.round + 1});

        emit Paid(stationId, p.payee, amount, p.kind == Kind.Claim ? Reason.Claim : Reason.Stop);
        if (amount != 0) _push(p.payee, amount);
    }

    // ---- Unclaimed ---------------------------------------------------------------

    /// @notice After the unclaimed period with no claim, anyone can send the balance to the creator
    /// fund. Not while an approved claim is waiting out its 72 hours.
    function releaseToFund(uint256 stationId) external {
        Station storage s = stations[stationId];
        if (s.status != Status.Open) revert StationClosed();
        // forge-lint: disable-next-line(block-timestamp)
        if (s.firstDepositAt == 0 || block.timestamp < uint256(s.firstDepositAt) + unclaimedPeriod) {
            revert StillClaimable();
        }
        Pending memory p = pending[stationId];
        if (p.readyAt != 0) revert ClaimWaiting();

        uint256 amount = s.balance;
        s.balance = 0;
        s.status = Status.Unclaimed;
        s.payee = creatorFund;
        totalHeld -= amount;
        pending[stationId] = Pending({payee: address(0), kind: Kind.None, approvals: 0, readyAt: 0, round: p.round + 1});

        emit Paid(stationId, creatorFund, amount, Reason.Unclaimed);
        if (amount != 0) _push(creatorFund, amount);
    }

    /// @notice Pays out deposits that arrived after a station closed. Anyone can call it; it only
    /// pays an address money is already owed to (a claimed station's creator, or the fund).
    function flush(address to) external {
        uint256 amount = forwarded[to];
        if (amount == 0) revert NothingOwed();
        forwarded[to] = 0;
        totalHeld -= amount;
        emit Flushed(to, amount);
        _push(to, amount);
    }

    // ---- Views -------------------------------------------------------------------

    function balanceOf(uint256 stationId) external view returns (uint256) {
        return stations[stationId].balance;
    }

    // ---- Internal ----------------------------------------------------------------

    function _credit(uint256 stationId, uint256 amount) private {
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (amount > type(uint128).max) revert TooLarge();
        Station storage s = stations[stationId];
        totalHeld += amount;
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
            forwarded[s.payee] += amount;
            emit Deposited(stationId, amount, s.payee);
        }
    }

    function _pull(uint256 amount) private {
        (bool ok, bytes memory data) =
            address(usdc).call(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
