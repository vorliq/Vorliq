import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Achievements from "./Achievements";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { achievements: [], earned: [] } });
});

test("renders the achievements page", async () => {
  render(
    <MemoryRouter>
      <Achievements />
    </MemoryRouter>
  );
  expect(await screen.findByRole("heading", { name: /^achievements$/i })).toBeInTheDocument();
});
