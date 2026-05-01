const ENS_SUBGRAPH =
  "https://api.studio.thegraph.com/query/49574/enssepolia/version/latest";

export async function getOwnedSubnames(
  ownerAddress: string,
  parentEns: string,
): Promise<string[]> {
  const query = `
    query GetSubdomains($first: Int) {
      domains(where: { name: "${parentEns}" }) {
        id
        name
        subdomains(first: $first) {
          id
          name
          labelName
          owner {
            id
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(ENS_SUBGRAPH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { first: 100 },
      }),
    });

    const json = (await res.json()) as {
      data?: {
        domains: Array<{
          subdomains: Array<{
            name: string;
            owner: { id: string };
          }>;
        }>;
      };
    };

    const domain = json.data?.domains?.[0];
    if (!domain?.subdomains) {
      return [];
    }

    // Filter by owner if provided
    return domain.subdomains
      .filter(
        (sub) =>
          !ownerAddress ||
          sub.owner.id.toLowerCase() === ownerAddress.toLowerCase(),
      )
      .map((sub) => sub.name);
  } catch (err) {
    console.error("getOwnedSubnames error:", err);
    return [];
  }
}

export async function getOwnedBiomeSubnames(
  ownerAddress: string,
  parentEns: string,
): Promise<string[]> {
  return getOwnedSubnames(ownerAddress, `biomes.${parentEns}`);
}
