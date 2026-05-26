import { render, screen } from "@testing-library/react";

import Network from "./Network";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("react-toastify", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/peers") {
      return Promise.resolve({ data: { success: true, peers: [] } });
    }
    if (path === "/registry/nodes") {
      return Promise.resolve({ data: { success: true, nodes: [] } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Network page shows Node Operator Tools", async () => {
  render(<Network />);

  expect(await screen.findByRole("heading", { name: /node operator tools/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /node guide/i })).toHaveAttribute("href", "/docs/run-your-own-node.html");
  expect(screen.getByRole("link", { name: /bootstrap verification/i })).toHaveAttribute("href", "/docs/bootstrap-verification.html");
  expect(screen.getByRole("link", { name: /status page/i })).toHaveAttribute("href", "https://status.vorliq.org");
  expect(screen.getByRole("link", { name: /readiness page/i })).toHaveAttribute("href", "/readiness");
});
