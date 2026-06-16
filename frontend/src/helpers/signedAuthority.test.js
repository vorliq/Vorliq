import api from "./api";
import { signMessage } from "./signer";
import {
  AUTHORIZATION_DOMAIN,
  authorityBodyHash,
  authorityErrorMessage,
  authorityMessage,
  canonicalJson,
  createSignedAuthorityRequest,
  postSignedAuthority,
} from "./signedAuthority";
import { loadWallet } from "./storage";

jest.mock("./api", () => ({
  post: jest.fn(),
}));

jest.mock("./signer", () => ({
  signMessage: jest.fn(),
}));

jest.mock("./storage", () => ({
  loadWallet: jest.fn(),
}));

const localWallet = {
  address: "3MNQE1X7T4Bz9kLmNpQrStUvWx",
  public_key: "PUBLIC_KEY_FIXTURE",
  private_key: "LOCAL_SIGNING_FIXTURE",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(1700000000000);
  loadWallet.mockResolvedValue(localWallet);
  signMessage.mockResolvedValue("fixture-signature");
  api.post.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("canonical body hash and authorization message match the backend cross-runtime vector", async () => {
  const body = {
    amount: 10,
    reason: "Community work",
    requester_address: localWallet.address,
  };
  const bodyHash = await authorityBodyHash(body);

  expect(canonicalJson(body)).toBe(
    `{"amount":10,"reason":"Community work","requester_address":"${localWallet.address}"}`
  );
  expect(bodyHash).toBe("306a764ac47e83ec1a6366464338434e9d8f91b172a872f418ce37e17aace7bc");
  expect(
    authorityMessage({
      action: "lending.request",
      bodyHash,
      nonce: "nonce-example-1234",
      timestamp: 1700000000,
      wallet: localWallet.address,
    })
  ).toBe(
    `{"action":"lending.request","body_hash":"${bodyHash}","domain":"${AUTHORIZATION_DOMAIN}",` +
      `"nonce":"nonce-example-1234","timestamp":1700000000,"wallet":"${localWallet.address}"}`
  );
});

test.each([
  ["governance.propose", "/governance/propose", "proposer_address"],
  ["governance.vote", "/governance/vote", "voter_address"],
  ["governance.cancel", "/governance/cancel", "proposer_address"],
  ["treasury.propose", "/treasury/propose", "proposer_address"],
  ["treasury.vote", "/treasury/vote", "voter_address"],
  ["treasury.cancel", "/treasury/cancel", "proposer_address"],
  ["lending.request", "/lending/request", "requester_address"],
  ["lending.vote", "/lending/vote", "voter_address"],
  ["lending.repay", "/lending/repay", "repayer_address"],
])("%s is bound to its guarded route and derives the actor from the saved wallet", async (action, path, actorField) => {
  const request = await createSignedAuthorityRequest({
    action,
    body: { record_id: "fixture-record" },
    walletPassword: "local-password",
  });

  expect(request.path).toBe(path);
  expect(request.body[actorField]).toBe(localWallet.address);
  expect(request.body.authorization).toMatchObject({
    action,
    domain: AUTHORIZATION_DOMAIN,
    wallet: localWallet.address,
    public_key: localWallet.public_key,
    signature: "fixture-signature",
    timestamp: 1700000000,
  });
  expect(request.body.authorization.nonce).toMatch(/^authority-[A-Za-z0-9-]{16,}$/);
  expect(request.body.authorization.body_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(signMessage).toHaveBeenCalledWith({
    privateKeyPem: localWallet.private_key,
    message: request.body.authorization.message,
  });
  expect(JSON.stringify(request.body)).not.toContain(localWallet.private_key);
  expect(request.body).not.toHaveProperty("private_key");
  expect(request.body).not.toHaveProperty("wallet_password");
});

test("postSignedAuthority sends only the guarded route body and authorization envelope", async () => {
  await postSignedAuthority({
    action: "lending.repay",
    body: { loan_id: "loan-1" },
    walletPassword: "local-password",
  });

  expect(api.post).toHaveBeenCalledTimes(1);
  const [path, body] = api.post.mock.calls[0];
  expect(path).toBe("/lending/repay");
  expect(body).toMatchObject({
    loan_id: "loan-1",
    repayer_address: localWallet.address,
    authorization: {
      action: "lending.repay",
      wallet: localWallet.address,
    },
  });
  expect(JSON.stringify(body)).not.toContain("local-password");
  expect(JSON.stringify(body)).not.toContain(localWallet.private_key);
});

test("postSignedAuthority rejects an explicit unsuccessful response", async () => {
  api.post.mockResolvedValueOnce({ data: { success: false } });

  await expect(
    postSignedAuthority({
      action: "governance.vote",
      body: { proposal_id: "proposal-1", vote: "yes" },
      walletPassword: "local-password",
    })
  ).rejects.toThrow(/action was rejected/i);
});

test("local-only fields and unsupported actions are rejected before signing", async () => {
  await expect(
    createSignedAuthorityRequest({
      action: "governance.vote",
      body: { proposal_id: "proposal-1", private_key: "must-not-send" },
      walletPassword: "local-password",
    })
  ).rejects.toThrow(/forbidden local-only field/i);

  await expect(
    createSignedAuthorityRequest({
      action: "unknown.action",
      body: {},
      walletPassword: "local-password",
    })
  ).rejects.toThrow(/unsupported signed authority action/i);

  expect(signMessage).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

test("signed authorization errors are mapped to safe user-facing text", () => {
  expect(
    authorityErrorMessage(
      { response: { data: { error: { code: "AUTHORIZATION_SIGNATURE_INVALID", message: "raw verifier detail" } } } },
      "Unable to submit."
    )
  ).toBe("Signed wallet authorization was rejected. Check your saved wallet and try again.");
  expect(authorityErrorMessage(new Error("unexpected internal detail"), "Unable to submit.")).toBe("Unable to submit.");
});

test("known backend eligibility reasons become friendly guidance, unknown ones fall back", () => {
  // Specific, reviewed backend reasons are translated to actionable guidance...
  expect(
    authorityErrorMessage(
      { response: { data: { error: { code: "UPSTREAM_ERROR", message: "only VLQ holders can create governance proposals" } } } },
      "Unable to create proposal."
    )
  ).toMatch(/need to hold some VLQ/i);
  expect(
    authorityErrorMessage(
      { response: { data: { error: { code: "UPSTREAM_ERROR", message: "requester already has an active loan lifecycle" } } } },
      "Unable to submit loan request."
    )
  ).toMatch(/already have a loan in progress/i);
  // ...while an unrecognized upstream string never leaks raw — it falls back.
  expect(
    authorityErrorMessage(
      { response: { data: { error: { code: "UPSTREAM_ERROR", message: "some unexpected internal stack trace detail" } } } },
      "Unable to create proposal."
    )
  ).toBe("Unable to create proposal.");
});
