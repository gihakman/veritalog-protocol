/**
 * VeritaLog deploy script for GenLayer Testnet Bradbury.
 *
 * Uses the verified genlayer-js SDK: createAccount(privateKey) + createClient({ chain, account }).
 * The signing key is read from ACCOUNT_PRIVATE_KEY and is never logged or written to disk.
 *
 * Run:
 *   1. Fund the account address on Bradbury: https://testnet-faucet.genlayer.foundation
 *   2. export ACCOUNT_PRIVATE_KEY=0x...      (or put it in .env)
 *   3. npm run deploy
 *
 * On success the deployed contract address is written to
 * frontend/public/deployment.json so the website can read it at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  type TransactionHash,
  TransactionStatus,
  type DecodedDeployData,
} from "genlayer-js/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "contract", "veritalog.py");
const DEPLOYMENT_OUT = path.join(ROOT, "frontend", "public", "deployment.json");

function loadDotEnv(): void {
  // Minimal .env loader so `npm run deploy` works without extra dependencies.
  try {
    const raw = readFileSync(path.join(ROOT, ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const privateKey = process.env.ACCOUNT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "ACCOUNT_PRIVATE_KEY is not set. Copy .env.example to .env and add your Bradbury key, " +
        "or export ACCOUNT_PRIVATE_KEY before running.",
    );
  }

  const account = createAccount(privateKey as `0x${string}`);
  const client = createClient({ chain: testnetBradbury, account });

  // Never print the private key. Address is public and safe to show.
  console.log("Network        :", testnetBradbury.name, `(chainId ${testnetBradbury.id})`);
  console.log("Deployer       :", account.address);

  const code = new Uint8Array(readFileSync(CONTRACT_PATH));
  console.log("Contract       : contract/veritalog.py", `(${code.length} bytes)`);

  await client.initializeConsensusSmartContract();

  console.log("Deploying      : submitting transaction...");
  const txHash = (await client.deployContract({
    code,
    args: [],
  })) as TransactionHash;
  console.log("Tx hash        :", txHash);

  await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 200,
  });

  // Re-read the transaction to get the settled status and decoded deploy data.
  // (waitForTransactionReceipt may resolve before statusName is populated.)
  const tx = (await client.getTransaction({ hash: txHash })) as {
    statusName?: string;
    txDataDecoded?: DecodedDeployData;
    data?: { contract_address?: string };
  };

  const statusName = tx.statusName;
  if (statusName !== TransactionStatus.ACCEPTED && statusName !== TransactionStatus.FINALIZED) {
    throw new Error(`Deployment did not reach ACCEPTED/FINALIZED (status: ${statusName ?? "unknown"})`);
  }

  const contractAddress =
    tx.txDataDecoded?.contractAddress ?? tx.data?.contract_address;

  if (!contractAddress) {
    throw new Error("Deployment accepted but no contract address was returned.");
  }

  console.log("Contract addr  :", contractAddress);
  console.log("Explorer       :", `https://explorer-bradbury.genlayer.com/address/${contractAddress}`);

  const deployment = {
    address: contractAddress,
    network: "testnet-bradbury",
    chainId: testnetBradbury.id,
    rpc: "https://rpc-bradbury.genlayer.com",
    explorer: "https://explorer-bradbury.genlayer.com",
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(DEPLOYMENT_OUT), { recursive: true });
  writeFileSync(DEPLOYMENT_OUT, JSON.stringify(deployment, null, 2) + "\n");
  console.log("Wrote          :", path.relative(ROOT, DEPLOYMENT_OUT));
}

main().catch((err) => {
  console.error("Deploy failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
