contract Dapp {
  event Distress(string indexed message);
  event ReorgEvent(string indexed message);
  event SuperDistress(string indexed message);
  event Rescue(address indexed rescuer);
  bool public inTrouble = false;
  bool public superInTrouble = false;
  uint public counter; 
  uint public superCounter;
  uint public test3Counter;

  function distressCall() public {
     inTrouble = true;
     emit Distress("mayday");
     emit ReorgEvent("mayday");
  }

  function superDistressCall() public{
    superInTrouble = true;
    emit SuperDistress("poo");
  }
  
  function rescue() public {
     inTrouble = false;
     emit Rescue(msg.sender);
     counter = counter + 1;
  }

  function superRescue() public {
    superInTrouble = true;
    emit Rescue(msg.sender);
    superCounter = superCounter + 1;

  }
  
}