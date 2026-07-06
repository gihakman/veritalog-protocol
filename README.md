# VeritaLog

**Trustless changelog attestation on GenLayer.**

A changelog is written by the same party that controls the code, so a release can
quietly understate or omit what actually changed. VeritaLog closes that gap. It
fetches a repository's published changelog and the real git diff between two
release tags, has independent GenLayer validators judge whether the changelog
describes the diff, and records the verdict on-chain.

Verdicts: `ACCURATE`, `PARTIAL`, `MISLEADING`. A coordinate with no attestation
reads back as `UNVERIFIED`.

## Live on Testnet Bradbury

| | |
|---|---|
| Network | GenLayer Testnet Bradbury (chainId `4221`) |
| Contract | [`0xcEE50E1b7581e0cb2c73b478126d914c65DbFBed`](https://explorer-bradbury.genlayer.com/address/0xcEE50E1b7581e0cb2c73b478126d914c65DbFBed) |
| Deploy transaction | [`0x1efdc335…7b46e344`](https://explorer-bradbury.genlayer.com/tx/0x1efdc3358afa0a8a2c7a1b6f405d2e698bdc972e2c0cb8a917a748427b46e344) |
| RPC | `https://rpc-bradbury.genlayer.com` |

## Why GenLayer

The core question, "does this changelog match this diff?", is subjective and
depends on live web data. A single server running an LLM would reintroduce a
trusted party: if it lies or disappears, the attestation is worthless.

GenLayer removes that trust. Each validator independently fetches the same public
sources and re-runs the judgment. Consensus is reached through the Equivalence
Principle: the transaction is accepted only when validators agree on the
`verdict`. The free-text reason is allowed to differ. Accepted verdicts enter a
finality window and can be appealed.

## How it works

1. A requester submits the repository, the before tag, the after tag, and the
   changelog URL. The contract derives the diff URL from GitHub's public compare
   endpoint.
2. The leader validator fetches the unified diff and the changelog text.
3. An LLM reads both as evidence and returns one verdict plus a short reason.
4. Validators re-run the judgment and agree only when the verdict matches. The
   agreed verdict is written to on-chain storage.

Consensus uses the partial-field-matching pattern with `gl.vm.run_nondet_unsafe`:
the validator re-derives its own verdict and compares only the decision field.
Failures are tagged `[EXPECTED]`, `[EXTERNAL]`, `[TRANSIENT]`, and `[LLM_ERROR]`
so validators compare error paths correctly rather than locking in a bad state.

## Contract interface

Storage is a `TreeMap[str, Attestation]` keyed `owner/repo@version`, with a key
index and a counter.

| Method | Kind | Arguments |
|---|---|---|
| `get_attestation` | view | `repo_owner, repo_name, version` |
| `total_attestations` | view | none |
| `list_recent` | view | `limit` |
| `request_attestation` | write | `repo_owner, repo_name, base_tag, head_tag, changelog_url` |
| `dispute_attestation` | write | `repo_owner, repo_name, version, note` |

## Tech stack

- **Intelligent Contract**: Python on GenVM, pinned runner version.
- **Consensus**: GenLayer Optimistic Democracy and the Equivalence Principle.
- **SDK**: `genlayer-js` for reads, wallet-signed writes, and deployment.
- **Frontend**: Vite and TypeScript, no framework runtime.
- **Tests**: `genlayer-test` direct mode with mocked web and LLM responses.

## Project structure

```
contract/veritalog.py     Intelligent Contract
deploy/deploy.ts          Bradbury deploy script (genlayer-js)
frontend/                 Documentation-first site with verify and request panels
tests/direct/             In-memory contract tests
gltest.config.yaml        Network and test configuration
vercel.json               Vercel build configuration for the frontend
```

## Contract development

Requires Python 3.12+, which the GenLayer SDK targets.

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install genvm-linter genlayer-test

genvm-lint check contract/veritalog.py     # lint and SDK validation
pytest tests/direct/ -v                     # in-memory tests
```

## Frontend

```bash
cd frontend
npm install
npm run build        # typecheck and production build to frontend/dist
```

The site reads the deployed contract address from `public/deployment.json` at
runtime. Verifying an attestation is a read and needs no wallet. Requesting an
attestation is a write and needs a browser wallet on Testnet Bradbury.

## Deploy

```bash
npm install
cp .env.example .env      # set ACCOUNT_PRIVATE_KEY for a funded Bradbury account
npm run deploy
```

Fund the deployer with test GEN at
[testnet-faucet.genlayer.foundation](https://testnet-faucet.genlayer.foundation).
The key is read only from the environment and is never logged or committed.

## Integrate in CI

Gate a dependency upgrade on the on-chain verdict. Reads require no key.

```ts
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const client = createClient({ chain: testnetBradbury });

const a = await client.readContract({
  address: "0xcEE50E1b7581e0cb2c73b478126d914c65DbFBed",
  functionName: "get_attestation",
  args: ["acme", "widget", "v2.0.0"],
});

if (a.verdict === "MISLEADING" || !a.exists) {
  process.exit(1); // block the upgrade
}
```

## License

MIT
