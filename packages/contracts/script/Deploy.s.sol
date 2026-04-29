// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {HermesInbox} from "../src/HermesInbox.sol";

contract DeployHermesInbox is Script {
    function run() external returns (HermesInbox inbox) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        inbox = new HermesInbox();
        vm.stopBroadcast();
        console2.log("HermesInbox deployed at:", address(inbox));
    }
}
