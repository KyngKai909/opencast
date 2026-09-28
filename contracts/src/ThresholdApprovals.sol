// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title ThresholdApprovals
/// @notice A multi-signature built into the contract: a set of keys, of which `threshold` must
/// approve the same thing. When they have, it waits `WAITING_PERIOD` in public before it can be
/// carried out, and any one key can cancel it until then. Changing the key set voids every
/// approval in progress. Each thing being approved is keyed by a number (a station, a grant).
abstract contract ThresholdApprovals is Initializable {
    uint256 public constant WAITING_PERIOD = 72 hours;
    uint256 public constant MAX_KEYS = 32;

    struct Proposal {
        /// What's being approved (a hash of its terms). Every approval must name the same.
        bytes32 subject;
        uint8 approvals;
        /// When it can be carried out: zero until the threshold is reached.
        uint64 readyAt;
        /// Bumped on cancel and when carried out, so earlier approvals don't count again.
        uint32 round;
        /// The key set it was approved under.
        uint32 epoch;
    }

    /// @custom:storage-location erc7201:opencast.storage.ThresholdApprovals
    struct ThresholdStorage {
        mapping(address => bool) isKey;
        address[] keys;
        uint256 threshold;
        uint32 epoch;
        mapping(uint256 => Proposal) proposals;
        mapping(uint256 => mapping(uint32 => mapping(uint32 => mapping(address => bool)))) approved;
    }

    // keccak256(abi.encode(uint256(keccak256("opencast.storage.ThresholdApprovals")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE = 0x9db6fdfe3c59ba814d043a607df16bbcff147a5f8c49ba515ff296f28a17bf00;

    event KeysChanged(address[] keys, uint256 threshold, uint32 epoch);
    event Approval(uint256 indexed key, address indexed by, bytes32 subject, uint256 approvals);
    event Ready(uint256 indexed key, bytes32 subject, uint256 readyAt);
    event Cancelled(uint256 indexed key, address indexed by);

    error BadKeys();
    error NotAKey();
    error DifferentSubject();
    error AlreadyApproved();
    error NothingPending();
    error NotReady();

    function _thresholdStorage() private pure returns (ThresholdStorage storage $) {
        assembly {
            $.slot := STORAGE
        }
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function __ThresholdApprovals_init(address[] memory keys_, uint256 threshold_) internal onlyInitializing {
        _setKeys(keys_, threshold_);
    }

    /// At least two keys must agree, there must be enough keys to reach it, and none may repeat.
    function _setKeys(address[] memory keys_, uint256 threshold_) internal {
        ThresholdStorage storage $ = _thresholdStorage();
        if (threshold_ < 2 || threshold_ > keys_.length || keys_.length > MAX_KEYS) revert BadKeys();
        for (uint256 i; i < $.keys.length; ++i) {
            $.isKey[$.keys[i]] = false;
        }
        delete $.keys;
        for (uint256 i; i < keys_.length; ++i) {
            address k = keys_[i];
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (k == address(0) || $.isKey[k] || !_mayHoldKey(k)) revert BadKeys();
            $.isKey[k] = true;
            $.keys.push(k);
        }
        $.threshold = threshold_;
        uint32 epoch = ++$.epoch;
        emit KeysChanged(keys_, threshold_, epoch);
    }

    /// Child contracts refuse addresses that must never hold a key (the fund, the contract itself).
    function _mayHoldKey(address) internal view virtual returns (bool) {
        return true;
    }

    /// Counts `msg.sender`'s approval of `subject` for `key`. The first approval in a round sets the subject.
    function _approve(uint256 key, bytes32 subject) internal returns (bool ready) {
        ThresholdStorage storage $ = _thresholdStorage();
        if (!$.isKey[msg.sender]) revert NotAKey();
        Proposal storage p = $.proposals[key];
        if (p.epoch != $.epoch) {
            // Approved under keys that have since changed: start again.
            p.subject = bytes32(0);
            p.approvals = 0;
            p.readyAt = 0;
            p.epoch = $.epoch;
        }
        if (p.readyAt != 0) revert AlreadyApproved();
        if (p.approvals == 0) p.subject = subject;
        else if (p.subject != subject) revert DifferentSubject();
        if ($.approved[key][p.epoch][p.round][msg.sender]) revert AlreadyApproved();
        $.approved[key][p.epoch][p.round][msg.sender] = true;
        uint8 approvals = ++p.approvals;
        emit Approval(key, msg.sender, subject, approvals);
        if (approvals == $.threshold) {
            // casting to 'uint64' is safe because timestamps fit in 64 bits for billions of years
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64 readyAt = uint64(block.timestamp + WAITING_PERIOD);
            p.readyAt = readyAt;
            emit Ready(key, subject, readyAt);
            return true;
        }
    }

    /// Any one key can cancel what's pending for `key`.
    function _cancel(uint256 key) internal {
        ThresholdStorage storage $ = _thresholdStorage();
        if (!$.isKey[msg.sender]) revert NotAKey();
        Proposal storage p = $.proposals[key];
        if (p.approvals == 0 || p.epoch != $.epoch) revert NothingPending();
        _reset(p);
        emit Cancelled(key, msg.sender);
    }

    /// The subject approved for `key`, once its wait is over; clears it so it can't be used twice.
    function _consume(uint256 key) internal returns (bytes32 subject) {
        ThresholdStorage storage $ = _thresholdStorage();
        Proposal storage p = $.proposals[key];
        // Windows are 72 hours long: a validator's few seconds of drift don't matter.
        // forge-lint: disable-next-line(block-timestamp)
        if (p.readyAt == 0 || p.epoch != $.epoch || block.timestamp < p.readyAt) revert NotReady();
        subject = p.subject;
        _reset(p);
    }

    /// Drops whatever is pending for `key` (the station closed some other way).
    function _clear(uint256 key) internal {
        Proposal storage p = _thresholdStorage().proposals[key];
        if (p.approvals != 0) _reset(p);
    }

    function _isWaiting(uint256 key) internal view returns (bool) {
        ThresholdStorage storage $ = _thresholdStorage();
        Proposal storage p = $.proposals[key];
        return p.readyAt != 0 && p.epoch == $.epoch;
    }

    function _reset(Proposal storage p) private {
        p.subject = bytes32(0);
        p.approvals = 0;
        p.readyAt = 0;
        ++p.round;
    }

    // ---- Views -------------------------------------------------------------------

    function isKey(address who) public view returns (bool) {
        return _thresholdStorage().isKey[who];
    }

    function keys() external view returns (address[] memory) {
        return _thresholdStorage().keys;
    }

    function threshold() external view returns (uint256) {
        return _thresholdStorage().threshold;
    }

    /// What's pending for `key`: its subject, approvals so far, and when it can be carried out (0: not yet approved).
    function proposal(uint256 key) public view returns (bytes32 subject, uint256 approvals, uint256 readyAt) {
        ThresholdStorage storage $ = _thresholdStorage();
        Proposal storage p = $.proposals[key];
        if (p.epoch != $.epoch) return (bytes32(0), 0, 0);
        return (p.subject, p.approvals, p.readyAt);
    }
}
