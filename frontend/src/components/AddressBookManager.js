// Address book management for Settings. Contacts are short labels for wallet
// addresses, used by the Send page so a user can type a name instead of a long
// address. Everything here is local-only and encrypted at rest with the wallet
// password (see helpers/addressBook) — it never goes to a server.
import { useEffect, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { saveAddressBook } from "../helpers/addressBook";
import { validateAddress } from "../helpers/address";

export default function AddressBookManager() {
  const { addressBook, refreshAddressBook, isLoggedIn } = useAuth();
  const [entries, setEntries] = useState(addressBook || []);
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState("");
  const [saving, setSaving] = useState(false);

  // Keep the editable list in sync when the session's contacts load/change.
  useEffect(() => {
    setEntries(addressBook || []);
  }, [addressBook]);

  function addEntry() {
    const cleanLabel = label.trim();
    const cleanAddr = addr.replace(/\s+/g, "");
    if (!cleanLabel || !cleanAddr) {
      setTone("error");
      setMessage("Enter both a name and a wallet address.");
      return;
    }
    const check = validateAddress(cleanAddr, { label: "address" });
    if (!check.valid) {
      setTone("error");
      setMessage(check.errors[0] || "That doesn't look like a valid wallet address.");
      return;
    }
    if (entries.some((e) => e.address.toLowerCase() === cleanAddr.toLowerCase())) {
      setTone("error");
      setMessage("That address is already in your contacts.");
      return;
    }
    setEntries([...entries, { label: cleanLabel, address: cleanAddr }].sort((a, b) => a.label.localeCompare(b.label)));
    setLabel("");
    setAddr("");
    setTone("");
    setMessage("Added. Click Save contacts to store it securely.");
  }

  function removeEntry(address) {
    setEntries(entries.filter((e) => e.address !== address));
    setMessage("Removed. Click Save contacts to apply.");
    setTone("");
  }

  async function save() {
    if (!password) {
      setTone("error");
      setMessage("Enter your wallet password to encrypt and save your contacts on this device.");
      return;
    }
    setSaving(true);
    try {
      await saveAddressBook(entries, password);
      await refreshAddressBook(password);
      setPassword("");
      setTone("success");
      setMessage("Contacts saved securely on this device.");
    } catch (error) {
      setTone("error");
      setMessage("Could not save contacts. Check your password and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <section className="card card-pad stack">
        <h2>Address book</h2>
        <p className="help-text">Sign in to your wallet to manage your contacts.</p>
      </section>
    );
  }

  return (
    <section className="card card-pad stack">
      <h2>Address book</h2>
      <p className="help-text">
        Give the addresses you send to often a short name. On the Send page you can then type the name instead
        of pasting a long address. Your contacts are stored only on this device, encrypted with your wallet
        password, so they never leave your browser.
      </p>

      <div className="admin-list">
        {entries.length === 0 ? (
          <div className="admin-row"><span>No contacts yet. Add your first one below.</span></div>
        ) : (
          entries.map((entry) => (
            <div className="admin-row" key={entry.address}>
              <strong>
                {entry.label}
                <span className="muted mono-wrap"> · {entry.address}</span>
              </strong>
              <button className="button secondary small-button" type="button" onClick={() => removeEntry(entry.address)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div className="grid meta-grid">
        <div className="vn-field">
          <label htmlFor="ab-label">Contact name</label>
          <input id="ab-label" className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mum, Alice, Shop" />
        </div>
        <div className="vn-field">
          <label htmlFor="ab-addr">Wallet address</label>
          <input id="ab-addr" className="input mono-wrap" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Vorliq wallet address" />
        </div>
      </div>
      <div className="button-row">
        <button className="button secondary small-button" type="button" onClick={addEntry}>Add contact</button>
      </div>

      <div className="vn-field">
        <label htmlFor="ab-pass">Wallet password (to encrypt &amp; save)</label>
        <input id="ab-pass" className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your wallet password" />
      </div>
      <div className="button-row">
        <button className="button" type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save contacts"}
        </button>
      </div>
      {message && <p className={`help-text ${tone === "error" ? "vn-field__hint--error" : ""}`} role="status">{message}</p>}
    </section>
  );
}
