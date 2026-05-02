import {
  loadAgents,
  getCoordinator,
  getQuorumAgents,
} from "../registry.js";
import { spawnAgentRuntime } from "../runtime/agentRuntime.js";
import { makeCoordinatorHandler } from "./coordinator.js";
import { makeMemberHandler } from "./member.js";

// The "reporter" role was removed on 2026-05-02 — the coordinator now
// synthesises the final report inline (after tally → LLM → final-response
// DM) to cut 3 0G uploads per round. The reporter agent files remain in
// the repo (demoted in `roles`) and `quorum/reporter.ts` is preserved as a
// reference for re-enabling the two-phase pattern. See memory entry
// "Quorum topology variants" for when to use the reporter pattern.

export async function bootQuorum(biomeName: string): Promise<() => void> {
  loadAgents();
  const coordinator = getCoordinator();
  const members = getQuorumAgents();

  if (!coordinator) {
    console.warn("[quorum] no coordinator agent found — quorum disabled");
    return () => {};
  }
  if (members.length === 0) {
    console.warn("[quorum] no quorum members found — quorum disabled");
    return () => {};
  }

  console.log(
    `[quorum] booting: coordinator=${coordinator.slug}, members=[${members.map((m) => m.slug).join(", ")}], biome=${biomeName}`,
  );

  const stops: Array<() => void> = [];

  stops.push(
    await spawnAgentRuntime(
      coordinator,
      makeCoordinatorHandler(coordinator, {
        biomeName,
        members,
      }),
    ),
  );

  for (const m of members) {
    stops.push(
      await spawnAgentRuntime(
        m,
        makeMemberHandler(m, {
          coordinatorEns: coordinator.ens,
          biomeName,
        }),
      ),
    );
  }

  console.log(`[quorum] all ${stops.length} runtimes booted`);
  return () => stops.forEach((s) => s());
}
