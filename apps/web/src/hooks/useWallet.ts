import { useAccount, useWalletClient } from "wagmi";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  return { address, isConnected, walletClient };
}
