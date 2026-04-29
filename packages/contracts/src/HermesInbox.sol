// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HermesInbox
/// @notice Minimal onchain index for Hermes envelopes.
/// Senders append a (recipientNode, rootHash) tuple; recipients poll logs
/// filtered by their indexed ENS namehash. The actual encrypted envelope
/// lives in 0G Storage at `rootHash`.
///
/// Threading: `replyTo` correlates a response with a prior message.
/// - Fresh message: `replyTo == bytes32(0)`
/// - Response: `replyTo == rootHash of the message being replied to`
/// Indexed so a sender can subscribe to replies to a specific message.
contract HermesInbox {
    /// @param toNode    namehash of the recipient ENS name (indexed for log filtering)
    /// @param from      msg.sender — the sending address (indexed)
    /// @param replyTo   rootHash of the message this is replying to, or 0 for a fresh message (indexed)
    /// @param rootHash  0G Storage root hash of this envelope
    /// @param timestamp block.timestamp at append
    event Message(
        bytes32 indexed toNode,
        address indexed from,
        bytes32 indexed replyTo,
        bytes32 rootHash,
        uint256 timestamp
    );

    /// @notice Append a fresh message pointer to the recipient's inbox.
    function send(bytes32 toNode, bytes32 rootHash) external {
        emit Message(toNode, msg.sender, bytes32(0), rootHash, block.timestamp);
    }

    /// @notice Append a reply correlated to a prior message.
    /// @param toNode   namehash of recipient ENS name
    /// @param replyTo  rootHash of the message being replied to (must be non-zero)
    /// @param rootHash 0G Storage root hash of this reply envelope
    function reply(bytes32 toNode, bytes32 replyTo, bytes32 rootHash) external {
        require(replyTo != bytes32(0), "replyTo required");
        emit Message(toNode, msg.sender, replyTo, rootHash, block.timestamp);
    }
}
