import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Privacy from "./Privacy";
import Whitepaper from "./Whitepaper";
import NotFound from "./NotFound";
import Ambassador from "./Ambassador";

function renderPage(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

test("Privacy renders its policy heading", () => {
  renderPage(<Privacy />);
  expect(screen.getByRole("heading", { level: 1, name: /what we collect/i })).toBeInTheDocument();
});

test("Whitepaper renders its overview heading", () => {
  renderPage(<Whitepaper />);
  expect(screen.getByRole("heading", { name: /community blockchain software/i })).toBeInTheDocument();
});

test("NotFound renders the 404 message", () => {
  renderPage(<NotFound />);
  expect(screen.getByRole("heading", { name: /doesn.t exist/i })).toBeInTheDocument();
});

test("Ambassador renders its call to action", () => {
  renderPage(<Ambassador />);
  expect(screen.getByRole("heading", { name: /become a vorliq ambassador/i })).toBeInTheDocument();
});
