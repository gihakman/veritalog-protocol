// Runtime configuration. The deployed contract address is read from
// /deployment.json, which the deploy script writes after a successful deploy.
// Until then the address is empty and the UI reports "not yet deployed".

export interface Deployment {
  address: string;
  network: string;
  chainId: number;
  rpc: string;
  explorer: string;
  deployedAt: string;
}

const FALLBACK: Deployment = {
  address: "",
  network: "testnet-bradbury",
  chainId: 4221,
  rpc: "https://rpc-bradbury.genlayer.com",
  explorer: "https://explorer-bradbury.genlayer.com",
  deployedAt: "",
};

let cached: Deployment | null = null;

export async function getDeployment(): Promise<Deployment> {
  if (cached) return cached;
  let resolved: Deployment = FALLBACK;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}deployment.json`, {
      cache: "no-store",
    });
    if (res.ok) {
      resolved = { ...FALLBACK, ...(await res.json()) };
    }
  } catch {
    // fall through to fallback
  }
  cached = resolved;
  return resolved;
}

export function isDeployed(d: Deployment): boolean {
  return typeof d.address === "string" && d.address.startsWith("0x") && d.address.length >= 42;
}
