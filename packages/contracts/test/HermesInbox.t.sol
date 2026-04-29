// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HermesInbox} from "../src/HermesInbox.sol";

contract HermesInboxTest is Test {
    HermesInbox inbox;

    address alice = address(0xA11CE);
    bytes32 aliceNode = keccak256("alice.hermes.eth");
    bytes32 bobNode = keccak256("bob.hermes.eth");
    bytes32 rootA = keccak256("blob-A");
    bytes32 rootB = keccak256("blob-B");

    event Message(
        bytes32 indexed toNode,
        address indexed from,
        bytes32 indexed replyTo,
        bytes32 rootHash,
        uint256 timestamp
    );

    function setUp() public {
        inbox = new HermesInbox();
    }

    function test_send_emitsMessageWithZeroReplyTo() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Message(bobNode, alice, bytes32(0), rootA, block.timestamp);
        inbox.send(bobNode, rootA);
    }

    function test_reply_emitsMessageWithReplyTo() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Message(bobNode, alice, rootA, rootB, block.timestamp);
        inbox.reply(bobNode, rootA, rootB);
    }

    function test_reply_revertsOnZeroReplyTo() public {
        vm.prank(alice);
        vm.expectRevert(bytes("replyTo required"));
        inbox.reply(bobNode, bytes32(0), rootB);
    }

    function test_send_anyoneCanSendToAnyone() public {
        // No access control: alice can send to bob's node without permission.
        vm.prank(alice);
        inbox.send(bobNode, rootA);

        // And to her own node.
        vm.prank(alice);
        inbox.send(aliceNode, rootA);
    }
}
