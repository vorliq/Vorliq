import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Register from "./Register";

jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ createAndSaveWallet: jest.fn(), isLoggedIn: false }),
}));

test("renders the account-creation page for a signed-out visitor", () => {
  render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>
  );
  expect(screen.getByRole("heading", { name: /create your vorliq account/i })).toBeInTheDocument();
});
