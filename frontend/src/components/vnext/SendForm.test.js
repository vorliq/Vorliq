// Safety-focused unit tests for the LIVE send flow (this component serves the
// /send route and the Wallet page). Ported from the retired legacy Send page's
// safety suite: the properties that matter are that signing happens locally,
// the private key never leaves the browser, and nothing is broadcast unless
// the user's inputs validate AND they authorize with their wallet password.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import SendForm from "./SendForm";
import { useAuth } from "../../context/AuthContext";
import { useSharedWalletBalance } from "../../context/WalletBalanceContext";
import api from "../../helpers/api";
import { loadWallet } from "../../helpers/storage";
import { signTransaction } from "../../helpers/signer";

jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../../context/WalletBalanceContext", () => ({
  useSharedWalletBalance: jest.fn(),
}));

jest.mock("../../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("../../helpers/storage", () => ({
  loadWallet: jest.fn(),
}));

jest.mock("../../helpers/signer", () => ({
  signTransaction: jest.fn(),
}));

const sender = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
const receiver = "7YWHMfk9JZe9LMQaPq2X3B4C5D";

function renderForm(auth = { isLoggedIn: true, wallet: { address: sender, public_key: "PUBLIC_KEY" }, addressBook: [] }) {
  useAuth.mockReturnValue(auth);
  return render(
    <MemoryRouter>
      <SendForm />
    </MemoryRouter>
  );
}

async function fillForm({ to = receiver, amount = "2", password = "wallet-pass" } = {}) {
  if (to) await userEvent.type(screen.getByLabelText(/recipient address/i), to);
  if (amount) await userEvent.type(screen.getByLabelText(/amount in VLQ/i), amount);
  if (password) await userEvent.type(screen.getByLabelText(/wallet password/i), password);
}

describe("SendForm safety flow (live /send component)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSharedWalletBalance.mockReturnValue({ available: 100, pendingIncoming: 0 });
    loadWallet.mockResolvedValue({ private_key: "LOCAL_PRIVATE_KEY" });
    signTransaction.mockResolvedValue({
      sender_address: sender,
      receiver_address: receiver,
      amount: 2,
      signature: "abcdef",
      sender_public_key: "PUBLIC_KEY",
    });
    api.post.mockResolvedValue({
      data: { success: true, tx_id: "tx-safe-123", transaction: { tx_id: "tx-safe-123", status: "pending" } },
    });
  });

  test("signed out: shows a sign-in note and never renders the form", () => {
    renderForm({ isLoggedIn: false, wallet: null, addressBook: [] });
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/wallet password/i)).not.toBeInTheDocument();
  });

  test("a valid send signs locally and the private key never reaches the wire", async () => {
    renderForm();
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    // The wallet was decrypted locally with the password the user typed.
    await waitFor(() => expect(loadWallet).toHaveBeenCalledWith("wallet-pass"));
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ senderAddress: sender, senderPrivateKey: "LOCAL_PRIVATE_KEY" })
    );
    // Only the signed payload is posted — no private key in any shape.
    expect(api.post).toHaveBeenCalledWith("/transaction/send", expect.any(Object));
    const posted = api.post.mock.calls[0][1];
    expect(Object.keys(posted)).not.toEqual(
      expect.arrayContaining(["senderPrivateKey", "private_key", "sender_private_key"])
    );
    expect(JSON.stringify(posted)).not.toContain("LOCAL_PRIVATE_KEY");
    // The status panel takes over and shows the transaction hash.
    expect(await screen.findByText(/transaction hash/i)).toBeInTheDocument();
    expect(screen.getByText("tx-safe-123")).toBeInTheDocument();
  });

  test("a wrong wallet password refuses to sign and broadcasts nothing", async () => {
    loadWallet.mockRejectedValue(new Error("Incorrect password."));
    renderForm();
    await fillForm({ password: "not-the-right-password" });
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    // Back on the form (not the status panel), with the password cleared.
    expect(screen.getByLabelText(/wallet password/i)).toHaveValue("");
  });

  test("a missing password blocks before any key material is touched", async () => {
    renderForm();
    await fillForm({ password: "" });
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wallet password/i);
    expect(loadWallet).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("sending to your own address is blocked with no broadcast", async () => {
    renderForm();
    await fillForm({ to: sender });
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/same address/i);
    expect(api.post).not.toHaveBeenCalled();
  });

  test("a zero amount is blocked with no broadcast", async () => {
    renderForm();
    await fillForm({ amount: "0" });
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("an amount above the spendable balance is blocked with no broadcast", async () => {
    renderForm();
    await fillForm({ amount: "250" });
    expect(screen.getByText(/exceeds the VLQ you have available/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("a backend rejection surfaces as an error, not a fake success", async () => {
    api.post.mockResolvedValue({ data: { success: false, error: "sender does not have enough confirmed VLQ" } });
    renderForm();
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/transaction hash/i)).not.toBeInTheDocument();
  });

  test("Send another resets to a clean form after a submission", async () => {
    renderForm();
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /send VLQ/i }));
    await screen.findByText(/transaction hash/i);

    await userEvent.click(screen.getByRole("button", { name: /send another/i }));
    expect(screen.getByLabelText(/recipient address/i)).toHaveValue("");
    expect(screen.getByLabelText(/wallet password/i)).toHaveValue("");
  });
});
