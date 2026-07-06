// Thin wrapper over genlayer-js for reading and writing the VeritaLog contract
// on Testnet Bradbury. Reads need no wallet; writes go through the browser wallet.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus, type TransactionHash } from "genlayer-js/types";
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

export type RequestStage = "signing" | "submitted" | "confirming" | "accepted";

export interface RequestProgress {
  stage: RequestStage;
  txHash?: string;
  message: string;
}

/** Translate raw wallet/RPC/contract errors into a clear, actionable message. */
export function explainError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();

  if (m.includes("nonce")) {
    return (
      "Your wallet's transaction nonce is out of sync with the network, so the " +
      "transaction was not accepted. In MetaMask open Settings > Advanced > " +
      "Clear activity tab data (this only clears the local cache, not your funds), " +
      "then submit again."
    );
  }
  if (m.includes("user rejected") || m.includes("user denied") || m.includes("rejected the request")) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  if (m.includes("insufficient funds") || m.includes("insufficient balance")) {
    return (
      "This account has no test GEN to pay for gas. Fund it at " +
      "https://testnet-faucet.genlayer.foundation and try again."
    );
  }
  if (m.includes("chain") && (m.includes("mismatch") || m.includes("4221") || m.includes("switch"))) {
    return "Switch your wallet to Testnet Bradbury (chain 4221), then submit again.";
  }
  // Contract-side classified errors surface their prefix; make them readable.
  if (raw.includes("[EXTERNAL]") || raw.includes("[TRANSIENT]")) {
    return (
      "The diff or changelog could not be fetched. Check that the base and head " +
      "tags exist and the changelog URL loads, then try again. (" +
      raw.replace(/.*\[(EXTERNAL|TRANSIENT)\]\s*/, "") +
      ")"
    );
  }
  if (raw.includes("[EXPECTED]")) {
    return raw.replace(/.*\[EXPECTED\]\s*/, "");
  }
  if (raw.includes("[LLM_ERROR]")) {
    return "The model returned an unusable result and validators rotated. Try submitting again.";
  }
  if (m.includes("undetermined")) {
    return (
      "Validators could not reach consensus on this release (undetermined). " +
      "No verdict was stored. You can try again."
    );
  }
  return raw;
}

export async function requestAttestation(
  account: string,
  repoOwner: string,
  repoName: string,
  baseTag: string,
  headTag: string,
  changelogUrl: string,
  onProgress: (p: RequestProgress) => void,
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

  onProgress({ stage: "signing", message: "Confirm the transaction in your wallet." });

  const txHash = (await client.writeContract({
    address: d.address as `0x${string}`,
    functionName: "request_attestation",
    args: [repoOwner, repoName, baseTag, headTag, changelogUrl],
    value: 0n,
  })) as unknown as string;

  onProgress({ stage: "submitted", txHash, message: "Transaction submitted to Bradbury." });
  onProgress({
    stage: "confirming",
    txHash,
    message: "Validators are fetching the diff and changelog and voting on the verdict.",
  });

  await client.waitForTransactionReceipt({
    hash: txHash as unknown as TransactionHash,
    status: TransactionStatus.ACCEPTED,
    retries: 200,
  });

  onProgress({ stage: "accepted", txHash, message: "Accepted. The verdict is on-chain." });
  return txHash;
}
