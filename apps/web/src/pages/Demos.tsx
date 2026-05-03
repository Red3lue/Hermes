import { Link } from "react-router-dom";
import { HermesShell } from "@/components/HermesShell";

const demos = [
  {
    to: "/demos/quorum",
    title: "Quorum",
    subtitle: "Sealed request · 3-agent deliberation · synthesised reply",
    desc:
      "Any *.users.hermes.eth subdomain can submit a sealed request to the coordinator. It fans the question to a 3-agent biome, collects verdicts, synthesises and replies — every leg on chain.",
    badge: "flagship",
    accent: "cyan" as const,
  },
  {
    to: "/demos/selector",
    title: "Selector",
    subtitle: "Anima as routing manifest · soul becomes behaviour",
    desc:
      "The Selector reads its own encrypted Anima — a routing manifest of three expert ENS names — and dispatches your question to whichever expert fits. Edit the soul, change the routing.",
    badge: "anima",
    accent: "flux" as const,
  },
  {
    to: "/demos/chatbot",
    title: "Concierge",
    subtitle: "Encrypted 1:1 · ENS-addressed · ciphertext on chain",
    desc:
      "Send an encrypted DM to the concierge. The body is opaque ciphertext on chain. Multi-thread, walkable HistoryManifest, zero relays.",
    badge: null,
    accent: "cyan" as const,
  },
  {
    to: "/biomes",
    title: "Biome Explorer",
    subtitle: "Read any biome by ENS name",
    desc:
      "Open any biome, inspect its charter, member roster, encrypted Animus, and on-chain event log.",
    badge: null,
    accent: "flux" as const,
  },
];

export default function DemosPage() {
  return (
    <HermesShell crumbs={[{ label: "demos" }]}>
      <section className="px-6 pt-16 pb-10">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow mb-3">Live demos</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-tight">
            <span className="text-gradient-neon">Pick a demo.</span>
            <br />
            <span className="text-gray-100">Watch the chain.</span>
          </h1>
          <p className="mt-4 text-gray-400 max-w-2xl text-base leading-relaxed">
            All four demos run on Sepolia + 0G Galileo today. No backend
            coordination plane — every message is a sealed envelope on 0G with
            a pointer in HermesInbox. Click any tx hash inside to verify.
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="mx-auto max-w-6xl grid grid-cols-1 sm:grid-cols-2 gap-5">
          {demos.map((d) => {
            const isCyan = d.accent === "cyan";
            return (
              <Link
                key={d.to}
                to={d.to}
                className={
                  isCyan
                    ? "panel-neon card-hover-cyan group p-6 flex flex-col"
                    : "panel-neon-flux card-hover-flux group p-6 flex flex-col"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-2xl font-bold text-gray-100 group-hover:text-hermes-200 transition-colors">
                    {d.title}
                  </h2>
                  {d.badge && (
                    <span className={isCyan ? "pill-cyan" : "pill-flux"}>
                      {d.badge}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs font-mono uppercase tracking-widest text-gray-500">
                  {d.subtitle}
                </p>
                <p className="mt-4 text-sm text-gray-400 leading-relaxed flex-1">
                  {d.desc}
                </p>
                <span
                  className={
                    isCyan
                      ? "mt-5 font-display text-xs uppercase tracking-[0.22em] text-hermes-300 group-hover:text-hermes-200"
                      : "mt-5 font-display text-xs uppercase tracking-[0.22em] text-flux-300 group-hover:text-flux-200"
                  }
                >
                  Open →
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </HermesShell>
  );
}
