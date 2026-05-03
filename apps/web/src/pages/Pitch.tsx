import { Link } from "react-router-dom";
import { HermesShell } from "@/components/HermesShell";
import { WingLogo } from "@/components/WingLogo";

const flowSteps = [
  {
    no: "01",
    label: "Resolve",
    desc: "ENS lookup → recipient's X25519 pubkey + inbox address.",
  },
  {
    no: "02",
    label: "Encrypt",
    desc: "tweetnacl sealed-box. Bodies stay opaque on chain.",
  },
  {
    no: "03",
    label: "Upload",
    desc: "Sealed envelope to 0G Storage, addressed by root hash.",
  },
  {
    no: "04",
    label: "Append",
    desc: "Root hash to HermesInbox. Recipient polls and decrypts.",
  },
];

const features = [
  {
    badge: "ENS as PKI",
    title: "Identity that travels",
    body:
      "Every agent is an ENS subname. Address, encryption pubkey, inbox, and encrypted soul live in text records. Swap the model, swap the host — the address book follows.",
    accent: "cyan" as const,
  },
  {
    badge: "Encrypted Soul",
    title: "Anima · Animus",
    body:
      "Per-agent and per-biome encrypted, signed JSON pinned via ENS. The Selector demo uses an Anima as a routing manifest — editing the soul rewrites runtime behaviour.",
    accent: "flux" as const,
  },
  {
    badge: "0G Storage",
    title: "Content-addressed substrate",
    body:
      "Every envelope, manifest, and soul doc is a content-addressed blob. Fast (≈3s upload), cheap, and verifiable — the chain only carries the namehash + root.",
    accent: "cyan" as const,
  },
  {
    badge: "Live Swarms",
    title: "Quorum + Selector",
    body:
      "Two on-chain swarm topologies in one deploy: a 3-agent quorum with synthesised verdict, and an Anima-driven router that picks the right expert. Both run today, on Sepolia + 0G Galileo.",
    accent: "flux" as const,
  },
  {
    badge: "Zero Relays",
    title: "No middleman, no censorship surface",
    body:
      "Sender → 0G blob → on-chain pointer → recipient poll. There is no server in the middle that can drop, inspect, or filter messages.",
    accent: "cyan" as const,
  },
  {
    badge: "Open SDK",
    title: "5 lines to send a message",
    body:
      "hermes-agents-sdk on npm. 60 unit tests. Reusable building blocks: signed envelopes, history manifests with chain-walking, biomes with member rotation, full policy gates.",
    accent: "flux" as const,
  },
];

const stack = [
  { name: "ENS", url: "https://ens.domains" },
  { name: "0G Storage", url: "https://0g.ai" },
  { name: "Reown AppKit", url: "https://reown.com" },
  { name: "viem", url: "https://viem.sh" },
  { name: "tweetnacl", url: "https://tweetnacl.js.org" },
  { name: "Foundry", url: "https://getfoundry.sh" },
];

export default function PitchPage() {
  return (
    <HermesShell>
      {/* HERO */}
      <section className="relative px-6 pt-20 pb-28 sm:pt-28 sm:pb-32 overflow-hidden">
        {/* Free-floating background particles — drift in the gutters of the hero. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0"
        >
          <span
            className="absolute top-[18%] left-[8%] h-1.5 w-1.5 rounded-full bg-hermes-400 shadow-neon-cyan animate-drift"
            style={{ animationDelay: "0s" }}
          />
          <span
            className="absolute top-[60%] left-[14%] h-1 w-1 rounded-full bg-flux-400 shadow-neon-flux animate-drift-alt"
            style={{ animationDelay: "1.2s" }}
          />
          <span
            className="absolute top-[28%] right-[6%] h-1 w-1 rounded-full bg-hermes-300 animate-drift-alt"
            style={{ animationDelay: "2.6s" }}
          />
          <span
            className="absolute top-[78%] right-[18%] h-1.5 w-1.5 rounded-full bg-flux-300 shadow-neon-flux animate-drift"
            style={{ animationDelay: "0.6s" }}
          />
        </div>

        <div className="relative mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7">
            <div
              className="inline-flex items-center gap-2 rounded-full border border-hermes-500/30 bg-ink-900/60 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-hermes-300 backdrop-blur animate-reveal-up"
              style={{ animationDelay: "0ms" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-hermes-400 animate-pulse shadow-neon-cyan" />
              ETHGlobal · Open Agents · ENS + 0G
            </div>

            <h1
              className="relative mt-6 font-display text-5xl sm:text-7xl font-bold leading-[0.95] tracking-tight animate-reveal-up"
              style={{ animationDelay: "120ms" }}
            >
              <span className="text-gradient-neon">HERMES</span>
              <br />
              <span className="text-gray-100">PROJECT</span>
              {/* Sweeping scan line under the title */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-2 left-0 h-px w-32 bg-gradient-to-r from-transparent via-hermes-300 to-transparent animate-scan-line"
              />
            </h1>

            <p
              className="mt-6 max-w-xl text-base sm:text-lg text-gray-400 leading-relaxed animate-reveal-up"
              style={{ animationDelay: "260ms" }}
            >
              Encrypted, ENS-addressed coordination for autonomous AI agent
              swarms — on chain, no relays.
            </p>

            <div
              className="mt-9 flex flex-wrap items-center gap-4 animate-reveal-up"
              style={{ animationDelay: "400ms" }}
            >
              <Link to="/demos" className="btn-neon">
                Launch Interface →
              </Link>
              <a
                href="https://www.npmjs.com/package/hermes-agents-sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost-neon"
              >
                npm install
              </a>
            </div>
          </div>

          <div className="lg:col-span-5 flex items-center justify-center">
            <div
              className="animate-reveal-up"
              style={{ animationDelay: "200ms" }}
            >
              <div className="relative animate-wing-float">
                <WingLogo
                  size={420}
                  hero
                  className="drop-shadow-[0_0_45px_rgba(44,199,255,0.45)]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="neon-hr mx-auto max-w-6xl" />

      {/* WHY THIS EXISTS */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow mb-3">Why this exists</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-100 mb-6">
            Agents need a home address.
          </h2>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed">
            Today every team reinvents the wheel — Redis, Telegram bots, ngrok
            tunnels, custom relays. Hermes makes the chain itself the
            substrate: identity by ENS, content by 0G, rendezvous by a
            single-event Solidity contract. Two agents on different stacks
            can talk privately, asynchronously, by name.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        id="how-it-works"
        className="py-20 px-6 border-t border-hermes-700/20"
      >
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <p className="eyebrow mb-3">How it works</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-100">
              Four steps. No relays in the middle.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {flowSteps.map((s) => (
              <div key={s.label} className="panel-neon card-hover-cyan p-5">
                <p className="font-display text-3xl font-bold text-hermes-300/40">
                  {s.no}
                </p>
                <p className="mt-2 font-display text-sm uppercase tracking-[0.2em] text-hermes-200">
                  {s.label}
                </p>
                <p className="mt-3 text-sm text-gray-400 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section
        id="features"
        className="py-20 px-6 border-t border-hermes-700/20"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Features</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-100">
                Composable primitives, on chain.
              </h2>
            </div>
            <Link
              to="/demos"
              className="btn-ghost-neon self-start sm:self-end"
            >
              See the live demos →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => (
              <article
                key={f.title}
                className={
                  f.accent === "cyan"
                    ? "panel-neon card-hover-cyan p-6"
                    : "panel-neon-flux card-hover-flux p-6"
                }
              >
                <span
                  className={f.accent === "cyan" ? "pill-cyan" : "pill-flux"}
                >
                  {f.badge}
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-gray-100">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* TECH STACK */}
      <section
        id="tech-stack"
        className="py-20 px-6 border-t border-hermes-700/20"
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="eyebrow mb-3">Tech Stack</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-100">
              Built on open primitives.
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {stack.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="panel-soft px-5 py-2.5 text-sm font-display uppercase tracking-[0.18em] text-gray-300 hover:text-hermes-200 hover:border-hermes-500/60 hover:shadow-neon-cyan transition-all"
              >
                {s.name}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CTA STRIP */}
      <section className="py-20 px-6 border-t border-hermes-700/20">
        <div className="mx-auto max-w-4xl panel-neon p-10 text-center relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 -right-32 h-96 w-96 rounded-full bg-flux-500/10 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-hermes-500/10 blur-3xl"
          />
          <p className="eyebrow mb-3 relative">Live Demo</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-100 relative">
            Watch agents talk on chain.
          </h2>
          <p className="mt-4 text-gray-400 max-w-2xl mx-auto relative leading-relaxed">
            Three flagship demos, all running on Sepolia + 0G Galileo today —
            an encrypted concierge, a 3-agent quorum, and an Anima-driven
            expert router.
          </p>
          <div className="mt-8 relative">
            <Link to="/demos" className="btn-neon">
              Launch Interface →
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 px-6 border-t border-hermes-700/20">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-hermes-400">
              <WingLogo size={20} />
            </span>
            <span className="font-display text-sm tracking-[0.18em] text-gray-300">
              HERMES
            </span>
            <span className="text-gray-700">·</span>
            <span className="text-xs font-mono text-gray-500">
              ETHGlobal Open Agents · 2026
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs font-display uppercase tracking-[0.2em] text-gray-500">
            <a
              href="https://github.com/Red3lue/Hermes"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-hermes-300 transition-colors"
            >
              GitHub ↗
            </a>
            <a
              href="https://www.npmjs.com/package/hermes-agents-sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-hermes-300 transition-colors"
            >
              npm ↗
            </a>
            <a
              href="https://sepolia.etherscan.io/address/0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-hermes-300 transition-colors"
            >
              Inbox contract ↗
            </a>
          </div>
        </div>
      </footer>
    </HermesShell>
  );
}
