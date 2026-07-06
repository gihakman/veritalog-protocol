"""Direct-mode tests for the VeritaLog Intelligent Contract.

Run with:  pytest tests/direct/ -v
These run in-memory (no server) and mock the web + LLM calls. Direct mode runs
the leader function only; validator agreement is exercised via run_validator().
"""

import json

CONTRACT = "contract/veritalog.py"


def _mock_release(direct_vm, verdict: str = "ACCURATE", reason: str = "Matches diff."):
    # Diff endpoint (gl.nondet.web.get) and changelog page (gl.nondet.web.render).
    direct_vm.mock_web(
        r".*github\.com/.*/compare/.*\.diff",
        {"status": 200, "body": "diff --git a/x b/x\n+added line\n-removed line\n"},
    )
    direct_vm.mock_web(
        r".*example\.com/CHANGELOG.*",
        {"status": 200, "body": "## v2.0.0\n- added line\n- removed line\n"},
    )
    direct_vm.mock_llm(
        r".*supply-chain analyst.*",
        json.dumps({"verdict": verdict, "reason": reason}),
    )


def test_starts_empty(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    assert contract.total_attestations() == 0


def test_unknown_is_unverified(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    result = contract.get_attestation("acme", "widget", "v1.0.0")
    assert result["verdict"] == "UNVERIFIED"
    assert result["exists"] is False
    assert result["key"] == "acme/widget@v1.0.0"


def test_request_stores_verdict(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    _mock_release(direct_vm, verdict="MISLEADING", reason="Backdoor not disclosed.")

    contract.request_attestation(
        "acme", "widget", "v1.0.0", "v2.0.0", "https://example.com/CHANGELOG.md"
    )

    rec = contract.get_attestation("acme", "widget", "v2.0.0")
    assert rec["exists"] is True
    assert rec["verdict"] == "MISLEADING"
    assert rec["reason"] == "Backdoor not disclosed."
    assert rec["base_tag"] == "v1.0.0"
    assert rec["head_tag"] == "v2.0.0"
    assert rec["diff_url"].endswith("/compare/v1.0.0...v2.0.0.diff")
    assert contract.total_attestations() == 1


def test_recent_list(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    _mock_release(direct_vm, verdict="ACCURATE")

    contract.request_attestation(
        "acme", "widget", "v1.0.0", "v2.0.0", "https://example.com/CHANGELOG.md"
    )
    recent = contract.list_recent(10)
    assert len(recent) == 1
    assert recent[0]["verdict"] == "ACCURATE"


def test_invalid_changelog_url_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("https"):
        contract.request_attestation(
            "acme", "widget", "v1.0.0", "v2.0.0", "ftp://example.com/CHANGELOG.md"
        )


def test_dispute_only_by_requester(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    _mock_release(direct_vm, verdict="MISLEADING")
    contract.request_attestation(
        "acme", "widget", "v1.0.0", "v2.0.0", "https://example.com/CHANGELOG.md"
    )

    # A different account cannot dispute.
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the original requester"):
        contract.dispute_attestation("acme", "widget", "v2.0.0", "I disagree")

    # The original requester can, and the record is flagged (never deleted).
    direct_vm.sender = direct_alice
    contract.dispute_attestation("acme", "widget", "v2.0.0", "Changelog was accurate")
    rec = contract.get_attestation("acme", "widget", "v2.0.0")
    assert rec["disputed"] is True
    assert rec["appeal_note"] == "Changelog was accurate"
    assert rec["verdict"] == "MISLEADING"  # verdict preserved


def test_validators_agree_on_verdict(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    _mock_release(direct_vm, verdict="ACCURATE", reason="Leader wording.")
    contract.request_attestation(
        "acme", "widget", "v1.0.0", "v2.0.0", "https://example.com/CHANGELOG.md"
    )

    # A validator that returns the same verdict with different reason wording agrees.
    direct_vm.clear_mocks()
    _mock_release(direct_vm, verdict="ACCURATE", reason="Different wording, same verdict.")
    assert direct_vm.run_validator() is True

    # A validator that reaches a different verdict disagrees, forcing rotation.
    direct_vm.clear_mocks()
    _mock_release(direct_vm, verdict="PARTIAL", reason="I think it omits changes.")
    assert direct_vm.run_validator() is False
