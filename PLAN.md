# Hermes — Build Plan

**Today:** Tue Apr 29, 2026
**Target ship date:** Fri May 1 – Sat May 2
**Submission deadline:** Tue May 6
**Budget:** ~18h core + 4h video/polish, solo

You have 5–6 working days (Mon Apr 28 → Fri May 2, optionally Sat May 3 buffer). Shipping by May 1–2 leaves slack for the demo video and unforeseen breakage.

Scope cuts in this order if time slips: **stretch examples → CCIP-Read → group inboxes → 3-agent swarm.**

---

## Mon Apr 28 — Day 1: 0G spike + ENS subname (3h)

**Goal:** Eliminate the only existential risk. Prove the substrate works.

- [x] Read [0G Storage SDK docs](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk) (30 min, no AI)
- [x] Get 0G testnet faucet topup; put key + RPC into `.env`
- [x] Write `scripts/spike-0g.ts` yourself: upload 1KB blob → log rootHash → download by root → assert equal (60–90 min)
- [x] If it works: take a screenshot, you're feasible
- [ ] If it doesn't: debug for max 60 min, then fall back to IPFS (replan day 2)
- [x] Pick parent ENS domain you control on Sepolia (or buy one; <$5)
- [x] Verify ENS Sepolia resolver setup with one manual subname via the ENS app UI

**End-of-day deliverable:** `spike-0g.ts` round-trips. Parent ENS domain identified.

**Cut if behind:** nothing. This day cannot slip.

---

## Tue Apr 29 — Day 2: ENS plumbing + crypto (4h)

**Goal:** Read/write ENS records from code. Crypto primitives passing tests.

- [x] Read [ENS Subname + PublicResolver pages](https://docs.ens.domains/web/subdomains/) (20 min, no AI)
- [x] Write `packages/sdk/src/ens.ts`: `resolveAgent(name)` returning `{addr, pubkey, inbox}`, `setAgentRecords(name, records)` using @ensdomains/ensjs (60 min, your code)
- [x] Write `scripts/ens-test.ts`: set 3 records on a subname, read them back — tested on Sepolia ✓
- [x] Write `packages/sdk/src/crypto.ts`: tweetnacl box encrypt/decrypt + viem EIP-191 sign/verify + deterministic keypair from wallet signature (60 min, your code)
- [x] Write `packages/sdk/test/crypto.test.ts`: round-trip encrypt/decrypt, sign/verify, tampered envelope fails, deterministic keygen (9 tests green)
- [x] `pnpm test` green

**End-of-day deliverable:** ENS read/write works on Sepolia. Crypto unit tests pass.

**Cut if behind:** skip the spike-ens script (the SDK code itself proves it).

---

## Wed Apr 30 — Day 3: Inbox contract + envelope (3.5h)

**Goal:** The onchain index. The wire format.

- [ ] Write `packages/contracts/src/HermesInbox.sol`: ~30 lines, one function `append(bytes32 toNode, bytes32 rootHash)` emits indexed event (45 min)
- [ ] Write minimal Foundry test: append + assert event emitted (30 min)
- [ ] `forge script` deploy to Sepolia; record address in `.env` (30 min)
- [ ] Write `packages/sdk/src/envelope.ts`: canonical serialization (sorted keys, deterministic JSON), replay cache `Set<sender|nonce>` (45 min)
- [ ] Write `packages/sdk/src/inbox.ts`: `appendToInbox(toNode, rootHash)` and `readInbox(myNode, fromBlock)` via viem `getLogs` (45 min)
- [ ] Tests for envelope canonicalization

**End-of-day deliverable:** Contract deployed on Sepolia. Envelope spec stable. Inbox read/write works.

**Cut if behind:** skip Foundry tests; rely on the integration test on Day 4.

---

## Thu May 1 — Day 4: SDK integration + CLI + two-agent demo (4h) — **target ship date**

**Goal:** End-to-end working demo from the CLI.

- [ ] Write `packages/sdk/src/storage.ts`: thin wrapper over `@0glabs/0g-ts-sdk` upload/download (30 min)
- [ ] Write `packages/sdk/src/client.ts`: `Hermes` class with `register`, `send`, `fetchInbox`, `rotateKeys` — wire ens + crypto + storage + inbox together (90 min, your code)
- [ ] Write `packages/sdk/src/keystore.ts`: file-backed keypair persistence (15 min)
- [ ] Write `packages/cli/src/index.ts` + 5 commands using commander: `register`, `send`, `inbox`, `watch`, `rotate` (60 min)
- [ ] Hand-test: terminal A `hermes watch alice`, terminal B `hermes send alice "hello"` → A prints decrypted msg
- [ ] Hand-test: rotate keys, send again, still works (this is the demo's money shot)

**End-of-day deliverable:** Two-terminal demo runs end-to-end including key rotation. **If this works, you can submit even with no further work.**

**Cut if behind:** skip `keystore.ts` (hardcode keys in env); skip `watch` command (just `inbox` polling once).

---

## Fri May 2 — Day 5: README, docs, video, submit (4h)

**Goal:** Submission-ready.

- [ ] Update README with real quickstart (5-line example actually working) (30 min)
- [ ] Write `docs/architecture.md` (the diagram from your README, expanded) (30 min)
- [ ] Write `docs/threat-model.md`: what's protected, replay window, rotation grace (20 min)
- [ ] Write `docs/why-0g.md`: the "blob layer + onchain index" justification (20 min)
- [ ] Record demo video (target 2:30, hard cap 3:00):
  - 0:00–0:20 — the problem (offline agents, no servers)
  - 0:20–1:30 — live demo: two terminals, send, drain inbox
  - 1:30–2:15 — rotate keys live, send, still works
  - 2:15–3:00 — architecture: ENS + 0G + SDK
  - Plan to do 3–4 takes (60–90 min total)
- [ ] Submit to ENS Creative + ENS Integration + 0G Tooling tracks via ETHGlobal portal (30 min)
- [ ] Tag a v0.1 git release; pin contract addresses in README

**End-of-day deliverable:** All three submissions filed. Video uploaded.

**Cut if behind:** skip `docs/` files; the README + a strong video carry it.

---

## Sat May 3 — Buffer / Polish day (only if needed)

Use this only if any of the above slipped. **Don't add features here.** Use it to:

- Fix bugs found while recording the demo video
- Clean up the README screenshots
- Re-record video with a better take
- Push contract verifications on Etherscan (good "looks shipped" signal)

If everything's done, **stop**. Don't keep tinkering. Polished + submitted on May 2 beats spectacular + submitted May 5.

---

## Sun May 4 – Tue May 6 — Hands off

Submission's in. Watch for any judge feedback or DMs. If a glaring bug is reported, *one* hotfix is fine; don't restructure.

---

## Stretch goals (only if Day 4 finishes by Thursday lunch)

In strict priority order:

1. Live web demo (paste ENS name, send a message in browser) — biggest judge engagement boost
2. `agent.arp`-aware text records to align with the active ENS DAO proposal
3. `examples/three-agent-swarm/` — planner + researcher + critic
4. CCIP-Read offchain resolver writeup

Predicted to land: 0–1 of these. That's fine.

---

## Risk table for this timeline

| Risk | Day | Mitigation |
|---|---|---|
| 0G testnet faucet down | 1 | Switch to IPFS, lose 0G prize tracks |
| ENS Sepolia parent domain not yours | 1 | Buy `hermes-test.eth` mainnet (~$5) and use mainnet for demo |
| Crypto bug discovered late | 4 | Don't change `crypto.ts` after Day 2; freeze it |
| Demo video runs over 3 min | 5 | Pre-script every line; 3+ takes |
| Solo time slips | any | Drop stretch goals first, then `docs/` files, then fancy CLI |

---

## What success looks like by EOD May 2

- `pnpm install && pnpm build && pnpm test` green from a fresh clone
- Contract deployed on Sepolia, address in README
- Two-terminal demo runs from a fresh clone in <5 min following the README
- Video uploaded, ≤3 min, shows live key rotation
- Three submissions filed

That's it. Anything beyond that on May 2 is upside, not requirement.

---

## BIOME — optional Day 5 morning add-on

> ⚠️ Naming collision with `biome.json` (the linter). Resolve before shipping — see PROJECT.md "Future direction: BIOME" for context.

BIOME = a shared, signed, ENS-resolvable JSON context that multiple agents bind to as the precondition for collaborating on a goal. It composes with the existing Hermes primitives (ENS subname + 0G blob + EIP-191 sig) — no new infrastructure.

### Scope decision

- **v0 (alignment-only doc + envelope reference) — in scope** *only if* Day 4 finishes by Thursday lunch and the two-agent demo is solid.
- **v1 (shared workspace / append-log per BIOME) — out of scope.** Document in README as roadmap; build post-hackathon.
- **If Day 4 spills into Friday → drop BIOME entirely.** Don't ship a half-baked workspace; it weakens the submission.

### v0 task list (Fri May 2 morning, ~2h)

- [ ] Write `packages/sdk/src/biome.ts`: `createBiome(name, goal, members, rules)`, `fetchBiome(name)`, `isMember(biome, ensName)` — uploads JSON to 0G, sets ENS `text("biome.root")` (45 min)
- [ ] Add optional `biome?: { name, version, root }` field to envelope; recipient verifies sender is a member when present (15 min)
- [ ] Add CLI commands: `hermes biome create`, `hermes biome show <name>`, `hermes biome join <name>` (30 min)
- [ ] Update `examples/two-agent-demo` to create a tiny BIOME, send messages referencing it, recipient prints "from `<sender>` (in biome `<name>`): `<msg>`" (15 min)
- [ ] Add a 20-second clip to the demo video showing BIOME creation + a message scoped to it (15 min)

### Cut criteria during the day

- If `biome.ts` isn't passing a basic round-trip test by 11:00, **stop** — strip BIOME from the demo, focus on README and video for the Hermes core.
- Do not touch BIOME after 13:00 on Day 5. Video + submission take the afternoon.

### What changes in the submission narrative if BIOME ships

The 0G prize tracks shift in your favor:

| Track | Without BIOME | With BIOME v0 |
|---|---|---|
| 0G — Tooling & Core Extensions | 25–35% | 30–40% |
| 0G — Autonomous Agents & Swarms | 10–15% | 20–30% |
| ENS — Best Integration / Creative | unchanged | unchanged |

Modal-case prize EV moves from ~$1,400–2,000 to ~$1,800–2,500. Worth the 2 hours *if and only if* the core demo is rock-solid first.
