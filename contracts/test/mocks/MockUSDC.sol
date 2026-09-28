// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A 6-decimal token like USDC that logs every transfer out of a watched address,
/// so tests can check where the escrow's money went.
contract MockUSDC {
    string public constant name = "USD Coin (test)";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// Addresses a real USDC would refuse to send to (its blocklist).
    mapping(address => bool) public blocked;

    address public watched;

    struct Out {
        address to;
        uint256 amount;
        uint256 at;
    }
    Out[] public outs;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function watch(address who) external {
        watched = who;
    }

    function block_(address who, bool on) external {
        blocked[who] = on;
    }

    function outCount() external view returns (uint256) {
        return outs.length;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(!blocked[to] && !blocked[from], "blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (from == watched && amount != 0) outs.push(Out(to, amount, block.timestamp));
        emit Transfer(from, to, amount);
    }
}
