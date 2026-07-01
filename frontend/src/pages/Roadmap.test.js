import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Roadmap from "./Roadmap";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn() } }));

function mockRoadmap() {
  api.get.mockImplementation((path) => {
    if (path === "/version/metadata") return Promise.resolve({ data: { version: "1.0.0", released_at: 1700000000 } });
    if (path === "/roadmap") {
      return Promise.resolve({
        data: { items: [{ id: "r1", title: "Count-based pruning", status: "completed", description: "Bounds startup validation." }] },
      });
    }
    if (path === "/changelog") return Promise.resolve({ data: { entries: [{ version: "1.0.0", notes: ["Initial release"] }] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Roadmap />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the roadmap grouped by status once loaded", async () => {
  mockRoadmap();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^roadmap$/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /^completed$/i })).toBeInTheDocument();
  expect(screen.getByText(/count-based pruning/i)).toBeInTheDocument();
});

test("surfaces an error when the roadmap cannot load", async () => {
  api.get.mockRejectedValue({});
  renderPage();
  expect(await screen.findByText(/unable to load the public roadmap/i)).toBeInTheDocument();
});
