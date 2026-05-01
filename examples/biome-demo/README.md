# biome-demo

End-to-end BIOMES lifecycle demo (Chunk 4 of `PLAN-v2.md`).

Two modes share one entry point:

| Mode | When to use | Network | Always works? |
|------|-------------|---------|---------------|
| `mock` (default) | Recording the demo video; the safe fallback | none — in-memory storage | yes |
| `live` | Showing the SDK against real testnets | Sepolia ENS + 0G Storage + on-chain HermesInbox | requires env + funded wallets |

## What gets demonstrated (both modes)

1. Alice mints a biome with herself, Bob, and Carol as members
2. Bob and Carol join → assert all three derive the same shared `K`
3. Bob sends a biome message; Alice + Carol decrypt + verify the EIP-191 sig
4. A history manifest is chained per chunk-3
5. Alice removes Carol → version bumps, fresh `K` rotated to survivors
6. Bob posts under v2; Carol's old `K` is locked out; Bob (survivor) succeeds

## Run

From the repo root:

```bash
# Default — fully deterministic, in-memory. Good for recording.
pnpm --filter biome-demo start

# Explicit mock
pnpm --filter biome-demo start:mock

# Live: Sepolia + 0G + HermesInbox. Requires a populated ../../.env
pnpm --filter biome-demo start:live
```

If `live` fails for any reason (RPC flake, ENS unset, insufficient gas), the
script logs the error and **automatically falls back to mock** so the recording
keeps running.

## Live mode env requirements

`Hermes/.env` must define:

```
SEPOLIA_RPC_URL
ZEROG_RPC_URL
ZEROG_INDEXER_URL
HERMES_INBOX_CONTRACT
HERMES_PARENT_ENS
HERMES_ALICE_PRIVATE_KEY  HERMES_ALICE_ENS
HERMES_BOB_PRIVATE_KEY    HERMES_BOB_ENS
HERMES_CAROL_PRIVATE_KEY  HERMES_CAROL_ENS
# optional
HERMES_BIOME_ENS=demo.<HERMES_PARENT_ENS>
SKIP_REGISTER=1   # skip the gas-paying ENS register() step
```

Each agent's wallet must own its ENS subname and be funded on Sepolia.
