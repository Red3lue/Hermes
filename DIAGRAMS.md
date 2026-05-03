# Hermes — Architecture Diagrams

Five diagrams. Mermaid source — renders natively on GitHub, in any markdown
viewer that supports Mermaid, on [mermaid.live](https://mermaid.live), and
in the included `diagrams.html` (with the Hermes neon theme).

1. [General SDK architecture](#1-general-sdk-architecture)
2. [Anima / Animus — encrypted souls on chain](#2-anima--animus--encrypted-souls-on-chain)
3. [Demo · Chatbot (1:1 encrypted DM with HistoryManifest)](#3-demo--chatbot)
4. [Demo · Quorum (3-agent deliberation + synthesis)](#4-demo--quorum)
5. [Demo · Selector (Anima as routing manifest)](#5-demo--selector)

---

## 1. General SDK architecture

The end-to-end path of any Hermes message. Identity is ENS, content is 0G,
rendezvous is HermesInbox. The SDK abstracts every box on the sender and
recipient sides.

```mermaid
flowchart TB
    subgraph SENDER["📤 Sender · hermes-agents-sdk"]
        S1["resolveAgent(ens)<br/>→ pubkey, inbox"]
        S2["seal envelope<br/>nacl.box + EIP-191 sig"]
        S3["uploadBlob → 0G"]
        S4["appendToInbox tx"]
    end

    subgraph ENS["🪪 ENS · Sepolia"]
        E1["addr · hermes.pubkey<br/>hermes.inbox · hermes.anima<br/>biome.root · biome.animus"]
    end

    subgraph CHAIN["⛓️ HermesInbox · Sepolia · single-event rendezvous"]
        H1["event Message(<br/>toNode, from, replyTo,<br/>rootHash, ts)"]
    end

    subgraph ZG["☁️ 0G Storage · Galileo"]
        Z1["sealed envelopes"]
        Z2["HistoryManifest"]
        Z3["AnimaDoc · AnimusDoc"]
        Z4["BiomeDoc"]
    end

    subgraph RECIPIENT["📥 Recipient · hermes-agents-sdk"]
        R1["readInbox<br/>filter by my namehash"]
        R2["downloadBlob"]
        R3["verify EIP-191 sig"]
        R4["nacl.box.open"]
        R5["render / reply"]
    end

    S1 -.read.-> E1
    S2 --> S3
    S3 -->|rootHash| Z1
    S3 -->|rootHash| Z2
    S4 -->|rootHash| H1

    H1 -->|getLogs| R1
    R1 --> R2
    Z1 -->|blob| R2
    R2 --> R3 --> R4 --> R5
```

**What's on chain in plaintext:** only the recipient's namehash and the 32-byte
rootHash. Bodies are sealed end-to-end with X25519. No relay, no middleman, no
central server that can drop or inspect a message.

---

## 2. Anima / Animus — encrypted souls on chain

Two named, verifiable, encrypted blobs that anchor identity at the *content* layer.
Anima = soul of an agent (self-encrypted). Animus = soul of a biome (K-encrypted).
Both pinned via ENS text records, both fetched fresh per request by the runtime.

```mermaid
flowchart TB
    subgraph OWNER["👤 Owner Wallet"]
        O1["sign + buildAnima<br/>nacl.box(plaintext, agent_pub, agent_sec)"]
        O2["sign + buildAnimus<br/>nacl.secretbox(plaintext, K)"]
    end

    subgraph ENS["🪪 ENS · per-agent / per-biome"]
        E1["text(hermes.anima)<br/>= 0G rootHash"]
        E2["text(biome.animus)<br/>= 0G rootHash"]
    end

    subgraph ZG["☁️ 0G Storage"]
        Z1["AnimaDoc<br/>encrypted to agent's own pubkey<br/>signed by owner"]
        Z2["AnimusDoc<br/>encrypted with biome key K<br/>signed by owner"]
    end

    subgraph RUNTIME["🤖 Agent Runtime · per request"]
        R1["resolveSouls()"]
        R2["peekAnima(ens)<br/>read text record"]
        R3["downloadBlob(rootHash)"]
        R4["decrypt with own keystore"]
        R5["inject into LLM<br/>system prompt"]
        R6["LLM reasons<br/>grounded in anima"]
    end

    subgraph MEMBERS["👥 Biome Members"]
        M1["hold wrapped K<br/>(unwrapKey via own keypair)"]
        M2["decrypt Animus<br/>with K"]
    end

    O1 -->|encrypt + upload| Z1
    O1 -->|setText rootHash| E1
    O2 -->|encrypt + upload| Z2
    O2 -->|setText rootHash| E2

    R1 --> R2
    R2 -.read.-> E1
    R2 --> R3
    R3 --> Z1
    Z1 --> R4
    R4 --> R5 --> R6

    M1 --> M2
    Z2 --> M2

    classDef owner fill:#1c0633,stroke:#c454ff,color:#e6ebf5
    classDef storage fill:#08243f,stroke:#2cc7ff,color:#e6ebf5
    class OWNER owner
    class ZG storage
```

**The Selector demo's pitch made literal:** the Selector's `resolveSouls()`
runs on every inbound request. It hits ENS for the latest rootHash, downloads
the encrypted blob from 0G, decrypts with the keystore, and injects the
plaintext into the LLM system prompt. **Edit the Anima → publish a new
rootHash → next request routes differently.** Soul becomes behaviour.

---

## 3. Demo · Chatbot

1:1 encrypted chat with the concierge. Each conversation is a `thread` tag on
the envelope; the concierge maintains a separate HistoryManifest chain per
`(user, thread)` so a fresh browser can recover the full transcript by
walking the chain backwards.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as 🌐 Browser (FE)
    participant ENS as 🪪 ENS
    participant Inbox as ⛓️ HermesInbox
    participant ZG as ☁️ 0G Storage
    participant Concierge as 🤖 Concierge Runtime
    participant LLM as 🧠 Claude

    User->>FE: Connect wallet · type "hello"
    FE->>FE: Derive X25519 from wallet sig
    FE->>ENS: resolve concierge.hermes.eth
    ENS-->>FE: pubkey + inbox addr
    FE->>FE: seal envelope (nacl.box + sig)
    FE->>ZG: uploadBlob(envelope)
    ZG-->>FE: rootHash R₁
    FE->>ZG: uploadBlob(HistoryManifest H₁)
    FE->>Inbox: send(toNode=concierge, R₁)
    Note over Inbox: event Message emitted

    loop poll every 3s
        Concierge->>Inbox: getLogs(toNode=concierge)
    end
    Inbox-->>Concierge: Message{ R₁ }
    Concierge->>ZG: downloadBlob(R₁)
    Concierge->>Concierge: verify sig + decrypt

    Concierge->>ENS: peekAnima(concierge.hermes.eth)
    ENS-->>Concierge: anima rootHash
    Concierge->>ZG: download AnimaDoc
    Concierge->>Concierge: decrypt with own keystore

    Concierge->>LLM: persona + anima + history + msg
    LLM-->>Concierge: reply text

    Concierge->>ZG: uploadBlob(sealed reply R₂)
    Concierge->>ZG: uploadBlob(HistoryManifest H₂)
    Concierge->>Inbox: send(toNode=user, R₂)

    FE->>Inbox: poll inbox
    Inbox-->>FE: Message{ R₂ }
    FE->>ZG: downloadBlob(R₂)
    FE->>FE: decrypt + render
```

**Receipts:** 2 Sepolia txs · 4 0G uploads · ~25–35s round-trip with
`finalityRequired: false` + 3s poll cadence.

---

## 4. Demo · Quorum

Public sealed request → coordinator dispatches to 3-agent biome → quorum
deliberates in parallel → coordinator tallies + synthesises → DMs final report
back to user.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as 🌐 Browser
    participant Inbox as ⛓️ HermesInbox
    participant ZG as ☁️ 0G Storage
    participant Coord as 🤖 Coordinator
    participant Architect as 🤖 Architect
    participant Pragma as 🤖 Pragmatist
    participant Skeptic as 🤖 Skeptic

    User->>FE: Question
    FE->>ZG: seal + upload (R₀)
    FE->>Inbox: send(coordinator, R₀)

    Coord->>Inbox: poll
    Inbox-->>Coord: R₀
    Coord->>ZG: download R₀, decrypt

    par Fan-out — 3 sealed DMs in parallel
        Coord->>ZG: seal for architect's pubkey (R₁ₐ)
        Coord->>Inbox: send(architect, R₁ₐ)
    and
        Coord->>ZG: seal for pragmatist's pubkey (R₁ᵦ)
        Coord->>Inbox: send(pragmatist, R₁ᵦ)
    and
        Coord->>ZG: seal for skeptic's pubkey (R₁ᵧ)
        Coord->>Inbox: send(skeptic, R₁ᵧ)
    end

    par Members deliberate independently
        Architect->>Architect: own anima + LLM
        Architect->>Inbox: send(coordinator, R₂ₐ)
    and
        Pragma->>Pragma: own anima + LLM
        Pragma->>Inbox: send(coordinator, R₂ᵦ)
    and
        Skeptic->>Skeptic: own anima + LLM
        Skeptic->>Inbox: send(coordinator, R₂ᵧ)
    end

    Coord->>Inbox: poll, collect 3 verdicts
    Coord->>Coord: tally + synthesise via LLM
    Coord->>ZG: seal final report (R₃)
    Coord->>Inbox: send(user, R₃)

    FE->>Inbox: poll
    Inbox-->>FE: Message{ R₃ }
    FE->>FE: decrypt · render with tally pills
```

**Receipts:** 8 Sepolia txs (1 user + 3 dispatch + 3 replies + 1 final) · 8 0G
uploads · agree/disagree/abstain tally on the final card.

---

## 5. Demo · Selector

Anima as routing manifest. The Selector reads its own ENS-pinned encrypted
soul, decides which expert to forward the question to, and returns the
expert's reply with attribution.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as 🌐 Browser
    participant Inbox as ⛓️ HermesInbox
    participant ENS as 🪪 ENS
    participant ZG as ☁️ 0G Storage
    participant Sel as 🤖 Selector
    participant Tech as 🛠️ Tech Expert
    participant LLM as 🧠 Claude

    User->>FE: "401 on every refresh — why?"
    FE->>ZG: seal + upload (R₀)
    FE->>Inbox: send(selector, R₀)

    Sel->>Inbox: poll
    Inbox-->>Sel: Message{ R₀ }
    Sel->>ZG: download R₀, decrypt

    rect rgba(196,84,255,0.10)
    Note over Sel: 🔮 Anima as routing manifest
    Sel->>ENS: peekAnima(selector.hermes.eth)
    ENS-->>Sel: anima rootHash (latest!)
    Sel->>ZG: download AnimaDoc
    Sel->>Sel: decrypt with own keystore
    end

    Sel->>LLM: persona + anima + question
    LLM-->>Sel: JSON { expert: "tech", reason: "..." }

    Sel->>ZG: seal expert-request for tech.experts.hermes.eth (R₁)
    Sel->>Inbox: send(tech-expert, R₁)

    Tech->>Inbox: poll
    Tech->>ZG: download R₁, decrypt
    Tech->>ENS: peekAnima(tech.experts.hermes.eth)
    Tech->>ZG: download own AnimaDoc, decrypt
    Tech->>LLM: persona + own anima + question
    LLM-->>Tech: domain answer
    Tech->>ZG: seal reply (R₂)
    Tech->>Inbox: send(selector, R₂)

    Sel->>Inbox: poll, get R₂, decrypt
    Sel->>Sel: wrap with "routed to tech because…"<br/>+ DM-direct footer
    Sel->>ZG: seal final (R₃)
    Sel->>Inbox: send(user, R₃)

    FE->>Inbox: poll
    Inbox-->>FE: Message{ R₃ }
    FE->>FE: render · "routed to tech" pill ✨
```

**The killer property:** the highlighted block reads the Anima from chain
*every request*, with a rootHash-keyed cache. Edit the Anima with one
`setText` transaction → the Selector's next inference uses the new manifest.
**Soul becomes behaviour, on chain, owner-mutable.**

---

## Rendering these diagrams

- **GitHub:** they render natively on the rendered README.
- **VS Code:** install the Mermaid Preview extension.
- **mermaid.live:** paste any block into [mermaid.live](https://mermaid.live)
  to export PNG/SVG.
- **Local with Hermes neon theme:** open `diagrams.html` in a browser.
