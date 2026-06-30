import { apiErrorMessage } from "./errors";

describe("apiErrorMessage", () => {
  test("prefers the upstream response message", () => {
    const error = { response: { data: { message: "specific message", error: "code" } }, message: "axios msg" };
    expect(apiErrorMessage(error, "fallback")).toBe("specific message");
  });

  test("falls back to response.data.error", () => {
    const error = { response: { data: { error: "ERR_CODE" } }, message: "axios msg" };
    expect(apiErrorMessage(error, "fallback")).toBe("ERR_CODE");
  });

  test("falls back to the error's own message", () => {
    expect(apiErrorMessage({ message: "network down" }, "fallback")).toBe("network down");
  });

  test("uses the provided fallback when nothing else is present", () => {
    expect(apiErrorMessage({}, "fallback")).toBe("fallback");
  });
});
