// Thin wrapper over genlayer-js for reading and writing the VeritaLog contract
// on Testnet Bradbury. Reads need no wallet; writes go through the browser wallet.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { getDeployment } from "./config";

export interface AttestationView {
  key: string;
  verdict: "ACCURATE" | "PARTIAL" | "MISLEADING" | "UNVERIFIED";
  reason: string;
  requester: string;
  repo_owner: string;
  repo_name: string;
  base_tag: string;
  head_tag: string;
  changelog_url: string;
  diff_url: string;
  attested_at: string;
  disputed: boolean;
  appeal_note: string;
  exists: boolean;
}

type EthereumProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function ethereum(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

export function hasWallet(): boolean {
  return ethereum() !== undefined;
}

async function readClient() {
  return createClient({ chain: testnetBradbury });
}

// ---- Reads -----------------------------------------------------------------

export async function getAttestation(
  repoOwner: string,
  repoName: string,
  version: string,
): Promise<AttestationView> {
  const d = await getDeployment();
  const client = await readClient();
  const result = await client.readContract({
    address: d.address as `0x${string}`,
    functionName: "get_attestation",
    args: [repoOwner, repoName, version],
  });
  return result as unknown as AttestationView;
}

export async function totalAttestations(): Promise<number> {
  const d = await getDeployment();
  const client = await readClient();
  const result = await client.readContract({
    address: d.address as `0x${string}`,
    functionName: "total_attestations",
    args: [],
  });
  return Number(result);
}

export async function listRecent(limit = 10): Promise<AttestationView[]> {
  const d = await getDeployment();
  const client = await readClient();
  const result = await client.readContract({
    address: d.address as `0x${string}`,
    functionName: "list_recent",
    args: [limit],
  });
  return (result as unknown as AttestationView[]) ?? [];
}

// ---- Wallet + write --------------------------------------------------------

export async function connectWallet(): Promise<string> {
  const eth = ethereum();
  if (!eth) throw new Error("No browser wallet detected. Install MetaMask to request attestations.");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("Wallet returned no accounts.");
  return accounts[0];
}

export async function requestAttestation(
  account: string,
  repoOwner: string,
  repoName: string,
  baseTag: string,
  headTag: string,
  changelogUrl: string,
): Promise<string> {
  const d = await getDeployment();
  const eth = ethereum();
  if (!eth) throw new Error("No browser wallet detected.");

  // The wallet signs writes. genlayer-js accepts the connected address as the
  // account and uses the injected EIP-1193 provider (window.ethereum).
  const client = createClient({
    chain: testnetBradbury,
    account: account as `0x${string}`,
  } as Parameters<typeof createClient>[0]);

  // Ensure the wallet is switched to Bradbury before sending.
  await (client as unknown as { connect: (n: string) => Promise<unknown> })
    .connect("testnetBradbury")
    .catch(() => undefined);

  const txHash = await client.writeContract({
    address: d.address as `0x${string}`,
    functionName: "request_attestation",
    args: [repoOwner, repoName, baseTag, headTag, changelogUrl],
    value: 0n,
  });

  await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 200,
  });

  return txHash as unknown as string;
}
