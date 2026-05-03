import {
  loadAgents,
  getSelectorAgent,
  getExpertAgents,
} from "../registry.js";
import { spawnAgentRuntime } from "../runtime/agentRuntime.js";
import { makeSelectorHandler } from "./selector.js";
import { makeExpertHandler } from "./expert.js";

/** Boot the Selector demo. The Selector reads its own Anima as a routing
 * manifest, classifies inbound requests, dispatches to one expert, and
 * forwards the expert's reply back to the user with a "routed to X
 * because Y" preamble.
 *
 * Each expert agent reads its own Anima as its domain expertise + voice.
 * Editing an expert's Anima at runtime changes how that expert answers.
 * Editing the Selector's Anima at runtime changes the routing decisions. */
export async function bootSelector(): Promise<() => void> {
  loadAgents();
  const selector = getSelectorAgent();
  const experts = getExpertAgents();

  if (!selector) {
    console.warn("[selector] no selector agent found — selector disabled");
    return () => {};
  }
  if (experts.length === 0) {
    console.warn("[selector] no expert agents found — selector disabled");
    return () => {};
  }

  console.log(
    `[selector] booting: selector=${selector.slug}, experts=[${experts.map((e) => e.slug).join(", ")}]`,
  );

  const stops: Array<() => void> = [];

  stops.push(
    await spawnAgentRuntime(
      selector,
      makeSelectorHandler(selector, { experts }),
    ),
  );

  for (const e of experts) {
    stops.push(
      await spawnAgentRuntime(
        e,
        makeExpertHandler(e, { selectorEns: selector.ens }),
      ),
    );
  }

  console.log(`[selector] all ${stops.length} runtimes booted`);
  return () => stops.forEach((s) => s());
}
