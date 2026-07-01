import {
  clearAddressBook,
  hasAddressBook,
  loadAddressBook,
  saveAddressBook,
  searchAddressBook,
} from "./addressBook";

beforeEach(() => {
  window.localStorage.clear();
});

test("hasAddressBook reflects whether an encrypted book is stored", async () => {
  expect(hasAddressBook()).toBe(false);
  await saveAddressBook([{ label: "Alice", address: "VLQ_ALICE" }], "pw");
  expect(hasAddressBook()).toBe(true);
});

test("save then load round-trips the contacts through encryption", async () => {
  const saved = await saveAddressBook(
    [
      { label: "Bob", address: "VLQ_BOB" },
      { label: "Alice", address: "VLQ_ALICE" },
    ],
    "pw"
  );
  // Returned list is sanitized + sorted by label.
  expect(saved).toEqual([
    { label: "Alice", address: "VLQ_ALICE" },
    { label: "Bob", address: "VLQ_BOB" },
  ]);
  expect(await loadAddressBook("pw")).toEqual(saved);
});

test("loading with no stored book returns an empty list, not a throw", async () => {
  expect(await loadAddressBook("pw")).toEqual([]);
});

test("loading with the wrong password fails the AES-GCM auth check", async () => {
  await saveAddressBook([{ label: "Alice", address: "VLQ_ALICE" }], "right");
  await expect(loadAddressBook("wrong")).rejects.toThrow();
});

test("saving sanitizes: trims labels, drops empties, dedupes by address, sorts", async () => {
  const clean = await saveAddressBook(
    [
      { label: "  Zed  ", address: "VLQ_Z" },
      { label: "", address: "VLQ_NOLABEL" }, // dropped: no label
      { label: "NoAddr", address: "" }, // dropped: no address
      { label: "Amy", address: "VLQ_AMY" },
      { label: "Duplicate", address: "vlq_amy" }, // dropped: same address (case-insensitive)
    ],
    "pw"
  );
  expect(clean).toEqual([
    { label: "Amy", address: "VLQ_AMY" },
    { label: "Zed", address: "VLQ_Z" },
  ]);
});

test("a label longer than the max is truncated", async () => {
  const longLabel = "x".repeat(80);
  const [entry] = await saveAddressBook([{ label: longLabel, address: "VLQ_X" }], "pw");
  expect(entry.label).toHaveLength(40);
});

test("saving an empty (or fully-invalid) list clears the stored book", async () => {
  await saveAddressBook([{ label: "Alice", address: "VLQ_ALICE" }], "pw");
  expect(hasAddressBook()).toBe(true);

  const result = await saveAddressBook([], "pw");
  expect(result).toEqual([]);
  expect(hasAddressBook()).toBe(false);
});

test("clearAddressBook removes the stored book", async () => {
  await saveAddressBook([{ label: "Alice", address: "VLQ_ALICE" }], "pw");
  clearAddressBook();
  expect(hasAddressBook()).toBe(false);
});

test("searchAddressBook matches on label and address, case-insensitively", () => {
  const entries = [
    { label: "Alice", address: "VLQ_ALICE_1" },
    { label: "Bob", address: "VLQ_BOB_2" },
  ];
  expect(searchAddressBook(entries, "ali")).toEqual([entries[0]]);
  expect(searchAddressBook(entries, "BOB_2")).toEqual([entries[1]]);
  expect(searchAddressBook(entries, "vlq")).toEqual(entries);
  expect(searchAddressBook(entries, "   ")).toEqual([]);
  expect(searchAddressBook(null, "a")).toEqual([]);
});
