// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ThresholdApprovals} from "./ThresholdApprovals.sol";

/// @title CreatorFund
/// @notice The fund that backs new stations and programs. It receives what claimable stations
/// never claimed (from CreatorEscrow) and the pool's fund share (`contribute`), in USDC, and
/// pays it out only as grants: a steward proposes one (who, how much, and a reference to the
/// public grant record), `threshold` stewards approve it, it waits 72 hours in public, during
/// which any one steward can cancel it, and then anyone can pay it.
///
/// A grant can never go to a steward, to the fund itself, or to an excluded address: Opencast's
/// own wallets are excluded, so the fund can't pay Opencast. The admin can add to the excluded
/// list but never remove from it. Upgradeable (UUPS); the admin role (meant for a 7-day
/// TimelockController the stewards can cancel) can change the stewards, exclude addresses, and
/// authorize an upgrade, and nothing else.
contract CreatorFund is AccessControlUpgradeable, UUPSUpgradeable, ThresholdApprovals {
    using SafeERC20 for IERC20;

    enum GrantStatus {
        None,
        Proposed,
        Paid,
        Cancelled
    }

    struct Grant {
        address recipient;
        uint128 amount;
        GrantStatus status;
        /// The grant's public record (a hash of the station or program, what it's for, the decision).
        bytes32 ref;
    }

    /// @custom:storage-location erc7201:opencast.storage.CreatorFund
    struct FundStorage {
        IERC20 usdc;
        uint256 nextGrantId;
        mapping(uint256 => Grant) grants;
        mapping(address => bool) excluded;
        uint256 totalContributed;
        uint256 totalGranted;
    }

    // keccak256(abi.encode(uint256(keccak256("opencast.storage.CreatorFund")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE = 0x0ac4eb30e202b8dc6552edc7596d4b148278be28160cd5f3351a5ea7d2c53000;

    event Contributed(address indexed from, uint256 amount, bytes32 indexed source);
    event GrantProposed(uint256 indexed grantId, address indexed recipient, uint256 amount, bytes32 ref, address by);
    event GrantCancelled(uint256 indexed grantId);
    event GrantPaid(uint256 indexed grantId, address indexed recipient, uint256 amount, bytes32 ref);
    event Excluded(address indexed who);

    error BadSetup();
    error ZeroAmount();
    error BadRecipient();
    error NoSuchGrant();
    error NotEnough();
    error TooLarge();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 usdc_,
        address[] calldata stewards,
        uint256 threshold_,
        address[] calldata excluded_,
        address admin
    ) external initializer {
        if (address(usdc_) == address(0) || admin == address(0)) revert BadSetup();
        FundStorage storage $ = _fund();
        $.usdc = usdc_;
        $.nextGrantId = 1;
        for (uint256 i; i < excluded_.length; ++i) {
            _exclude(excluded_[i]);
        }
        __AccessControl_init();
        __ThresholdApprovals_init(stewards, threshold_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---- In ----------------------------------------------------------------------

    /// @notice The pool's fund share, or anyone's gift. (Unclaimed escrow arrives by plain transfer.)
    function contribute(uint256 amount, bytes32 source) external {
        if (amount == 0) revert ZeroAmount();
        FundStorage storage $ = _fund();
        $.totalContributed += amount;
        emit Contributed(msg.sender, amount, source);
        $.usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ---- Grants ------------------------------------------------------------------

    /// @notice A steward proposes a grant; proposing counts as their approval.
    function proposeGrant(address recipient, uint256 amount, bytes32 ref) external returns (uint256 grantId) {
        if (!isKey(msg.sender)) revert NotAKey();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert TooLarge();
        _checkRecipient(recipient);
        FundStorage storage $ = _fund();
        grantId = $.nextGrantId++;
        // casting to 'uint128' is safe because larger amounts revert above
        // forge-lint: disable-next-line(unsafe-typecast)
        $.grants[grantId] = Grant(recipient, uint128(amount), GrantStatus.Proposed, ref);
        emit GrantProposed(grantId, recipient, amount, ref, msg.sender);
        _approve(grantId, _subject(grantId));
    }

    /// @notice Another steward approves the grant as proposed. At the threshold the 72-hour wait starts.
    function approveGrant(uint256 grantId) external {
        if (_fund().grants[grantId].status != GrantStatus.Proposed) revert NoSuchGrant();
        _approve(grantId, _subject(grantId));
    }

    /// @notice Any one steward can cancel a grant until it's paid. A cancelled grant is gone for good.
    function cancelGrant(uint256 grantId) external {
        Grant storage g = _fund().grants[grantId];
        if (g.status != GrantStatus.Proposed) revert NoSuchGrant();
        _cancel(grantId);
        g.status = GrantStatus.Cancelled;
        emit GrantCancelled(grantId);
    }

    /// @notice After the wait, anyone can pay an approved grant, to its recipient only.
    function executeGrant(uint256 grantId) external {
        FundStorage storage $ = _fund();
        Grant storage g = $.grants[grantId];
        if (g.status != GrantStatus.Proposed) revert NoSuchGrant();
        if (_consume(grantId) != _subject(grantId)) revert NoSuchGrant();
        // Exclusions and steward changes made since it was approved still apply.
        _checkRecipient(g.recipient);
        if ($.usdc.balanceOf(address(this)) < g.amount) revert NotEnough();
        g.status = GrantStatus.Paid;
        $.totalGranted += g.amount;
        emit GrantPaid(grantId, g.recipient, g.amount, g.ref);
        $.usdc.safeTransfer(g.recipient, g.amount);
    }

    // ---- Admin (through the timelock) ----------------------------------------------

    function setStewards(address[] calldata stewards, uint256 threshold_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setKeys(stewards, threshold_);
    }

    /// @notice Adds an address grants may never pay (Opencast's own wallets). There's no way to remove one.
    function exclude(address who) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _exclude(who);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _mayHoldKey(address k) internal view override returns (bool) {
        return k != address(this);
    }

    // ---- Views -------------------------------------------------------------------

    function usdc() external view returns (IERC20) {
        return _fund().usdc;
    }

    function balance() external view returns (uint256) {
        return _fund().usdc.balanceOf(address(this));
    }

    function grant(uint256 grantId) external view returns (Grant memory) {
        return _fund().grants[grantId];
    }

    function isExcluded(address who) external view returns (bool) {
        return _fund().excluded[who];
    }

    function totals() external view returns (uint256 contributed, uint256 granted) {
        FundStorage storage $ = _fund();
        return ($.totalContributed, $.totalGranted);
    }

    // ---- Internal ----------------------------------------------------------------

    function _fund() private pure returns (FundStorage storage $) {
        assembly {
            $.slot := STORAGE
        }
    }

    function _subject(uint256 grantId) private view returns (bytes32) {
        Grant storage g = _fund().grants[grantId];
        return keccak256(abi.encode(grantId, g.recipient, g.amount, g.ref));
    }

    function _checkRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this) || isKey(recipient) || _fund().excluded[recipient]) {
            revert BadRecipient();
        }
    }

    function _exclude(address who) private {
        FundStorage storage $ = _fund();
        if (!$.excluded[who]) {
            $.excluded[who] = true;
            emit Excluded(who);
        }
    }
}
