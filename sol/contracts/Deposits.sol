pragma solidity ^0.5.0;

contract PISAInterface {
    function getFlag() public returns (uint);
}

/*
 * We will let anyone lock up their eth and contribute towards our collateral
 * In return - we'll incorporate payments here such that the stakers get a share of our profit.
 * They are effectively "betting" on our good behaviour and in return we'll reward them for trusting us.
 */
contract PISADeposit {

    address public PISA;
    uint public withdrawperiod; // Shoud be VERY long (say 2-3 months).

    // Manage all deposits
    mapping(address => uint) public deposits;
    uint public totalDeposits;

    // Manage all withdrawals
    mapping(address => Withdraw) public withdrawals;
    uint public pendingwithdrawals;

    // Split into a struct for easy accounting.
    // TODO: Support depositing ERC-20 tokens
    struct Withdraw {
        uint amount;
        uint withdrawby;
    }

    // Lookup the PISA contract to confirm it isn't locked!
    modifier notLocked {
        require(PISAInterface(PISA).getFlag() != 2);
        _;
    }

    event Deposit(address sender, uint coins, uint timestamp);

    event PendingWithdrawal(address sender, uint coins, uint timestamp);

    event CompleteWithdrawal(address sender, uint coins, uint timestamp);

    // Set up a deposit contract for this PISA instance
    constructor(address _PISA, uint _withdrawperiod) public {
        PISA = _PISA;
        withdrawperiod = _withdrawperiod;
    }

    // Accept deposit from PISA and set up contract .
    // Can be re-used to topup deposit while channel is on
    function deposit() public payable {
        require(msg.value > 0);

        // Increment deposit
        deposits[msg.sender] = deposits[msg.sender] + msg.value;

        // Increment deposit count
        totalDeposits = totalDeposits + msg.value;

        // Notify world we have increased our deposit
        emit Deposit(msg.sender,msg.value,block.number);
    }

    // Transfer full deposit to another user.
    // Why? Enable secondary market for locked ether.
    function transferFullDepositOwnership(address _newOwner) public {
        uint amount = deposits[msg.sender];
        deposits[msg.sender] = 0;
        deposits[_newOwner] = deposits[_newOwner] + amount;
    }

    // Transfer partial deposit to another user
    // Why? Enable secondary market for locked ether.
    function transferPartialDepositOwnership(address _newOwner, uint _amount) public {
        require(deposits[msg.sender] >= _amount);
        deposits[msg.sender] = deposits[msg.sender] - _amount;
        deposits[_newOwner] = deposits[_newOwner] + _amount;
    }

    // Let PISA withdraw deposit after time period
    function initiateWithdraw(uint _toWithdraw) public notLocked {
        require(_toWithdraw > 0);
        require(deposits[msg.sender] >= _toWithdraw);

        // Deallocate deposit
        deposits[msg.sender] = deposits[msg.sender] - _toWithdraw;
        totalDeposits = totalDeposits - _toWithdraw;

        // Prepare withdrawal (and increase withdrawal time if need be)
        withdrawals[msg.sender].amount = withdrawals[msg.sender].amount + _toWithdraw;
        withdrawals[msg.sender].withdrawby = block.number + withdrawperiod;
        pendingwithdrawals = pendingwithdrawals + _toWithdraw;

        emit PendingWithdrawal(msg.sender, _toWithdraw, block.number);
    }

    // Let PISA withdraw deposit after time period
    function completeWithdraw() public notLocked {
        require(withdrawals[msg.sender].withdrawby > block.number);

        // Issue withdrawal
        uint amount = withdrawals[msg.sender].amount;
        withdrawals[msg.sender].amount = 0;
        msg.sender.transfer(amount);

        // No longer pending... update our statistics
        pendingwithdrawals = pendingwithdrawals - amount;

        emit CompleteWithdrawal(msg.sender, amount, block.number);
    }

    // Helper function
    function getTotalDeposits() public view returns(uint) {
        return totalDeposits;
    }
}
