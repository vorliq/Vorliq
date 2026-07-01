import { act, render } from "@testing-library/react";
import { io } from "socket.io-client";

import { RealtimeProvider, useRealtime } from "./RealtimeContext";
import { useAuth } from "./AuthContext";
import { useNotifications } from "./NotificationContext";

jest.mock("socket.io-client", () => ({ io: jest.fn() }));
jest.mock("./AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));
jest.mock("./NotificationContext", () => ({
  useNotifications: jest.fn(),
  NotificationProvider: ({ children }) => children,
}));

const addNotification = jest.fn();
const MY_ADDRESS = "VLQ_ME_ADDRESS";

let handlers;
function makeSocket() {
  handlers = {};
  return { on: (event, cb) => { handlers[event] = cb; }, off: jest.fn(), disconnect: jest.fn() };
}

function Consumer() {
  const { latestBlockHeight, exchangeVersion } = useRealtime();
  return (
    <div>
      <span data-testid="height">{String(latestBlockHeight)}</span>
      <span data-testid="version">{exchangeVersion}</span>
    </div>
  );
}

function renderRealtime() {
  return render(
    <RealtimeProvider>
      <Consumer />
    </RealtimeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  io.mockReturnValue(makeSocket());
  useAuth.mockReturnValue({ wallet: { address: MY_ADDRESS } });
  useNotifications.mockReturnValue({ addNotification });
});

test("block:new advances the latest block height monotonically", () => {
  const { getByTestId } = renderRealtime();
  act(() => handlers["block:new"]({ height: 5 }));
  expect(getByTestId("height").textContent).toBe("5");
  act(() => handlers["block:new"]({ height: 3 }));
  act(() => handlers["block:new"]({ height: "nope" }));
  expect(getByTestId("height").textContent).toBe("5");
});

test("exchange:update bumps the exchange version signal", () => {
  const { getByTestId } = renderRealtime();
  act(() => handlers["exchange:update"]({}));
  act(() => handlers["exchange:update"]({}));
  expect(getByTestId("version").textContent).toBe("2");
});

test("wallet events for my address raise bell notifications", () => {
  renderRealtime();
  act(() => handlers["wallet:credit"]({ address: MY_ADDRESS, amount: 5 }));
  act(() => handlers["loan:funded"]({ address: MY_ADDRESS }));
  act(() => handlers["loan:repaid"]({ address: MY_ADDRESS }));
  act(() => handlers["proposal:outcome"]({ address: MY_ADDRESS, title: "My proposal", status: "executed" }));
  expect(addNotification).toHaveBeenCalledTimes(4);
  expect(addNotification).toHaveBeenCalledWith("wallet_credit", "VLQ received", expect.stringContaining("5"), "/wallet");
});

test("wallet events for a different address are ignored", () => {
  renderRealtime();
  act(() => handlers["wallet:credit"]({ address: "VLQ_SOMEONE_ELSE", amount: 5 }));
  expect(addNotification).not.toHaveBeenCalled();
});

test("subscribes once and cleans up the socket on unmount", () => {
  const socket = makeSocket();
  io.mockReturnValue(socket);
  const { unmount } = renderRealtime();
  unmount();
  expect(socket.disconnect).toHaveBeenCalled();
});
