import "./styles.css";
import { getDeployment, isDeployed, type Deployment } from "./config";
import {
  getAttestation,
  totalAttestations,
  requestAttestation,
  connectWallet,
  hasWallet,
  type AttestationView,
} from "./genlayer";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let deployment: Deployment | null = null;
let walletAddress: string | null = null;

function verdictBadge(verdict: AttestationView["verdict"]): string {
  const cls =
    verdict === "ACCURATE"
      ? "v-accurate"
      : verdict === "PARTIAL"
        ? "v-partial"
        : verdict === "MISLEADING"
          ? "v-misleading"
          : "v-unverified";
  return `<span class="${cls}"><span class="badge">${verdict}</span></span>`;
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderAttestation(target: HTMLElement, a: AttestationView): void {
  target.classList.remove("error");
  if (!a.exists) {
    target.innerHTML =
      `<div class="verdict-line">${verdictBadge("UNVERIFIED")}` +
      `<span class="mono">${esc(a.key)}</span></div>` +
      `<p class="msg">No attestation exists for this repository and version yet. ` +
      `Anyone can request one below.</p>`;
    target.hidden = false;
    return;
  }
  const explorer = deployment?.explorer ?? "";
  target.innerHTML =
    `<div class="verdict-line">${verdictBadge(a.verdict)}` +
    `<span class="mono">${esc(a.key)}</span>` +
    (a.disputed ? `<span class="badge v-partial" style="color:var(--partial)">DISPUTED</span>` : "") +
    `</div>` +
    `<dl>` +
    `<dt>reason</dt><dd>${esc(a.reason) || "n/a"}</dd>` +
    `<dt>base → head</dt><dd>${esc(a.base_tag)} → ${esc(a.head_tag)}</dd>` +
    `<dt>diff</dt><dd><a href="${esc(a.diff_url)}" target="_blank" rel="noreferrer">${esc(a.diff_url)}</a></dd>` +
    `<dt>changelog</dt><dd><a href="${esc(a.changelog_url)}" target="_blank" rel="noreferrer">${esc(a.changelog_url)}</a></dd>` +
    `<dt>requester</dt><dd>${esc(a.requester)}</dd>` +
    `<dt>attested at</dt><dd>${esc(a.attested_at) || "n/a"}</dd>` +
    (a.disputed ? `<dt>appeal note</dt><dd>${esc(a.appeal_note)}</dd>` : "") +
    (explorer && deployment?.address
      ? `<dt>contract</dt><dd><a href="${explorer}/address/${deployment.address}" target="_blank" rel="noreferrer">${deployment.address}</a></dd>`
      : "") +
    `</dl>`;
  target.hidden = false;
}

function showError(target: HTMLElement, message: string): void {
  target.classList.add("error");
  target.innerHTML = `<p class="msg">${esc(message)}</p>`;
  target.hidden = false;
}

function guardDeployed(target: HTMLElement): boolean {
  if (!deployment || !isDeployed(deployment)) {
    showError(
      target,
      "The contract is not deployed yet. Run the deploy script against Testnet Bradbury, " +
        "then reload this page.",
    );
    return false;
  }
  return true;
}

async function doLookup(
  owner: string,
  repo: string,
  version: string,
  target: HTMLElement,
): Promise<void> {
  if (!owner || !repo || !version) {
    showError(target, "Enter owner, repo, and version.");
    return;
  }
  if (!guardDeployed(target)) return;
  target.hidden = false;
  target.classList.remove("error");
  target.innerHTML = `<p class="msg">Reading on-chain verdict…</p>`;
  try {
    const a = await getAttestation(owner.trim(), repo.trim(), version.trim());
    renderAttestation(target, a);
  } catch (err) {
    showError(target, err instanceof Error ? err.message : String(err));
  }
}

function wireHero(): void {
  $("hero-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void doLookup(
      $<HTMLInputElement>("h-owner").value,
      $<HTMLInputElement>("h-repo").value,
      $<HTMLInputElement>("h-version").value,
      $("hero-result"),
    );
  });
}

function wireVerify(): void {
  $("verify-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void doLookup(
      $<HTMLInputElement>("v-owner").value,
      $<HTMLInputElement>("v-repo").value,
      $<HTMLInputElement>("v-version").value,
      $("verify-result"),
    );
  });
}

function wireRequest(): void {
  const connectBtn = $<HTMLButtonElement>("connect-btn");
  const submitBtn = $<HTMLButtonElement>("submit-btn");
  const result = $("request-result");

  if (!hasWallet()) {
    connectBtn.textContent = "No wallet detected";
    connectBtn.disabled = true;
  }

  connectBtn.addEventListener("click", async () => {
    if (!guardDeployed(result)) return;
    try {
      walletAddress = await connectWallet();
      connectBtn.textContent = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
      submitBtn.disabled = false;
    } catch (err) {
      showError(result, err instanceof Error ? err.message : String(err));
    }
  });

  $("request-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!guardDeployed(result)) return;
    if (!walletAddress) {
      showError(result, "Connect a wallet first.");
      return;
    }
    const owner = $<HTMLInputElement>("r-owner").value.trim();
    const repo = $<HTMLInputElement>("r-repo").value.trim();
    const base = $<HTMLInputElement>("r-base").value.trim();
    const head = $<HTMLInputElement>("r-head").value.trim();
    const changelog = $<HTMLInputElement>("r-changelog").value.trim();

    result.hidden = false;
    result.classList.remove("error");
    result.innerHTML = `<p class="msg">Submitting transaction. Confirm in your wallet, then validators will judge the release…</p>`;
    submitBtn.disabled = true;
    try {
      const tx = await requestAttestation(walletAddress, owner, repo, base, head, changelog);
      const explorer = deployment?.explorer ?? "";
      result.innerHTML =
        `<p class="msg">Request accepted. The verdict for ` +
        `<span class="mono">${esc(owner)}/${esc(repo)}@${esc(head)}</span> is now on-chain.</p>` +
        `<dl><dt>tx</dt><dd>${explorer ? `<a href="${explorer}/tx/${esc(tx)}" target="_blank" rel="noreferrer">${esc(tx)}</a>` : esc(tx)}</dd></dl>`;
      void doLookup(owner, repo, head, $("verify-result"));
    } catch (err) {
      showError(result, err instanceof Error ? err.message : String(err));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function initFooterAndStats(): Promise<void> {
  deployment = await getDeployment();
  const addrEl = document.getElementById("foot-address") as HTMLAnchorElement | null;
  if (deployment && isDeployed(deployment)) {
    if (addrEl) {
      addrEl.textContent = deployment.address;
      addrEl.href = `${deployment.explorer}/address/${deployment.address}`;
    }
    try {
      const total = await totalAttestations();
      $("corpus-stat").textContent = `${total} attestation${total === 1 ? "" : "s"} recorded on-chain.`;
    } catch {
      /* reads may fail before the first attestation; ignore */
    }
  } else {
    $("corpus-stat").textContent =
      "Contract not deployed yet. Deploy to Bradbury to enable lookups.";
  }
}

wireHero();
wireVerify();
wireRequest();
void initFooterAndStats();
