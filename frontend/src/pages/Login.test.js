import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthProvider } from "../context/AuthContext";
import Login from "./Login";
import api from "../helpers/api";

jest.mock("../helpers/api");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
  ToastContainer: () => null,
}));

const CHAIN_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgd5YYdfUJahkiKysEUVSb
w8AEwDT8/8uMK97e0mF0QPChRANCAATPKGhjZjOg966bfk/CKy6wrWM1IHhbul09
Ck3lLjvgPQuq89ihk7ibS7AXaLOHmteM47L2BSMrRyuNuCRsDUFy
-----END PRIVATE KEY-----`;
const CHAIN_ADDRESS = "2Vd5aHn7Urus74JoecXxcyxmGtAc";
const KEY_BODY_CHUNK = "w8AEwDT8"; // a fragment unique to the key body

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </AuthProvider>
  );
}

async function fillPrivateKeyForm() {
  fireEvent.click(screen.getByRole("tab", { name: /private key/i }));
  fireEvent.change(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/i), { target: { value: CHAIN_PRIVATE_KEY_PEM } });
  fireEvent.change(screen.getByLabelText(/New Browser Password/i), { target: { value: "strong-pass-1" } });
  fireEvent.change(screen.getByLabelText(/Confirm Browser Password/i), { target: { value: "strong-pass-1" } });
  fireEvent.click(screen.getByLabelText(/responsible for keeping/i));
  fireEvent.click(screen.getByRole("button", { name: /import private key and sign in/i }));
}

function assertKeyNeverTransmitted() {
  const calls = [
    ...(api.get.mock?.calls || []),
    ...(api.post.mock?.calls || []),
    ...(api.put?.mock?.calls || []),
    ...(api.delete?.mock?.calls || []),
  ];
  const serialized = JSON.stringify(calls);
  expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  expect(serialized).not.toContain(KEY_BODY_CHUNK);
}

describe("private key import sign-in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test("derives the address, checks the chain by address only, and never transmits the key", async () => {
    api.get.mockResolvedValue({ data: { total: 4, balance: 120 } });

    renderLogin();
    await fillPrivateKeyForm();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // The only network call is a chain-record check keyed on the DERIVED ADDRESS.
    expect(api.get).toHaveBeenCalledWith("/wallet/history", {
      params: { address: CHAIN_ADDRESS, limit: 1, offset: 0 },
    });
    assertKeyNeverTransmitted();

    // The wallet is persisted ENCRYPTED — never the plaintext key.
    await waitFor(() => expect(window.localStorage.getItem("vorliq_wallet")).toBeTruthy());
    const stored = window.localStorage.getItem("vorliq_wallet");
    expect(stored).toContain("encrypted_private_key");
    expect(stored).not.toContain("BEGIN PRIVATE KEY");
    expect(stored).not.toContain(KEY_BODY_CHUNK);
    expect(stored).toContain(CHAIN_ADDRESS);
  });

  test("clears the key field from the DOM immediately after derivation", async () => {
    api.get.mockResolvedValue({ data: { total: 1, balance: 1 } });

    renderLogin();
    await fillPrivateKeyForm();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // After submit the page navigates away on success; while the field exists it
    // must not still hold the key. Re-query defensively.
    const field = screen.queryByPlaceholderText(/BEGIN PRIVATE KEY/i);
    if (field) expect(field.value).toBe("");
  });

  test("offers a proceed-anyway path when the address has no chain record", async () => {
    api.get.mockResolvedValue({ data: { total: 0, balance: 0 } });

    renderLogin();
    await fillPrivateKeyForm();

    await waitFor(() => expect(screen.getByText(/no chain record found/i)).toBeInTheDocument());
    expect(screen.getByText(new RegExp(CHAIN_ADDRESS))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in anyway/i })).toBeInTheDocument();
    assertKeyNeverTransmitted();

    fireEvent.click(screen.getByRole("button", { name: /sign in anyway/i }));
    await waitFor(() => expect(window.localStorage.getItem("vorliq_wallet")).toBeTruthy());
    expect(window.localStorage.getItem("vorliq_wallet")).not.toContain("BEGIN PRIVATE KEY");
  });

  test("shows a clear error for a malformed key and transmits nothing", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("tab", { name: /private key/i }));
    fireEvent.change(screen.getByPlaceholderText(/BEGIN PRIVATE KEY/i), { target: { value: "this is not a key" } });
    fireEvent.change(screen.getByLabelText(/New Browser Password/i), { target: { value: "strong-pass-1" } });
    fireEvent.change(screen.getByLabelText(/Confirm Browser Password/i), { target: { value: "strong-pass-1" } });
    fireEvent.click(screen.getByLabelText(/responsible for keeping/i));
    fireEvent.click(screen.getByRole("button", { name: /import private key and sign in/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(api.get).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("vorliq_wallet")).toBeNull();
    assertKeyNeverTransmitted();
  });
});
