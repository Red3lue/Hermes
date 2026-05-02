import { createAppKit } from "@reown/appkit/react";
import { sepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient } from "@tanstack/react-query";

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID ?? "";

export const queryClient = new QueryClient();

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [sepolia];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  themeMode: "dark",
  features: { analytics: false },
});

export { sepolia };
