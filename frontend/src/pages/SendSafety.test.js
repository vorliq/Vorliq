import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Send from "./Send";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { loadWallet } from "../helpers/storage";
import { signTransaction } from "../helpers/signer";

jest.mock("../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("../helpers/storage", () => ({
  loadWallet: jest.fn(),
}));

jest.mock("../helpers/signer", () => ({
  signTransaction: jest.fn(),
}));

jest.mock("../components/QRPayment", () => function MockQRPayment() {
  return <div data-testid="qr-payment" />;
});

jest.mock("react-toastify", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const sender = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
const receiver = "7YWHMfk9JZe9LMQaPq2X3B4C5D";

function renderSend(auth = { isLoggedIn: false, wallet: null }) {
  useAuth.mockReturnValue(auth);
  api.get.mockResolvedValue({ data: { balance: 100 } });
  return render(
    <MemoryRouter>
      <Send />
    </MemoryRouter>
  );
}

async function fillManualDetails({ amount = "2", to = receiver, from = sender } = {}) {
  await userEvent.type(screen.getByLabelText(/sender address/i), from);
  await userEvent.type(screen.getByLabelText(/sender private key/i), "PRIVATE_KEY");
  await userEvent.type(screen.getByLabelText(/sender public key/i), "PUBLIC_KEY");
  await userEvent.type(screen.getByLabelText(/receiver address/i), to);
  await userEvent.type(screen.getByLabelText(/amount of vlq/i), amount);
}

describe("Send safety flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadWallet.mockResolvedValue({ private_key: "LOCAL_PRIVATE_KEY" });
    signTransaction.mockResolvedValue({
      sender_address: sender,
      receiver_address: receiver,
      amount: 2,
      signature: "abcdef",
      sender_public_key: "PUBLIC_KEY",
    });
    api.post.mockResolvedValue({
      data: {
        success: true,
        tx_id: "tx-safe-123",
        transaction: { tx_id: "tx-safe-123", status: "pending" },
      },
    });
  });

  test("review step renders before sending", async () => {
    renderSend();
    await fillManualDetails();

    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    expect(screen.getByRole("heading", { name: /review transaction/i })).toBeInTheDocument();
    expect(screen.getByText(sender)).toBeInTheDocument();
    expect(screen.getByText(receiver)).toBeInTheDocument();
    expect(screen.getByText(/pending until mined/i)).toBeInTheDocument();
    expect(screen.getByText(/transactions cannot be reversed/i)).toBeInTheDocument();
  });

  test("same sender and receiver blocks send", async () => {
    renderSend();
    await fillManualDetails({ to: sender });

    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    expect(screen.getAllByText(/sender and receiver cannot be the same address/i).length).toBeGreaterThan(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  test("invalid amount blocks send", async () => {
    renderSend();
    await fillManualDetails({ amount: "0" });

    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    expect(screen.getAllByText(/amount must be greater than 0/i).length).toBeGreaterThan(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  test("logged-in send says private key stays local", async () => {
    renderSend({ isLoggedIn: true, wallet: { address: sender, public_key: "PUBLIC_KEY" } });

    expect(await screen.findByText(/private key stays in this browser/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/receiver address/i), receiver);
    await userEvent.type(screen.getByLabelText(/amount of vlq/i), "2");
    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    expect(screen.getAllByText(/private key stays in browser/i).length).toBeGreaterThan(0);
  });

  test("manual private key warning appears", () => {
    renderSend();

    expect(screen.getByText(/manual private key mode/i)).toBeInTheDocument();
    expect(screen.getByText(/pasted private keys are never saved/i)).toBeInTheDocument();
  });

  test("tx result shows tx_id and pending explanation", async () => {
    renderSend();
    await fillManualDetails();
    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm and send/i }));

    expect(await screen.findByText(/tx-safe-123/i)).toBeInTheDocument();
    expect(screen.getByText(/mining confirmation is required/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open transaction detail/i })).toHaveAttribute("href", "/tx/tx-safe-123");
  });

  test("duplicate send protection requires explicit confirmation", async () => {
    renderSend();
    await fillManualDetails();
    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm and send/i }));
    await screen.findByText(/tx-safe-123/i);

    await userEvent.click(screen.getByRole("button", { name: /send another/i }));
    await fillManualDetails();
    await userEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    expect(screen.getByText(/repeats the same send details/i)).toBeInTheDocument();
    const reviewPanel = screen.getByRole("heading", { name: /review transaction/i }).closest("section");
    expect(within(reviewPanel).getByRole("button", { name: /confirm and send/i })).toBeDisabled();
  });
});
