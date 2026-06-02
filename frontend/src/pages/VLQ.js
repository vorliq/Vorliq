import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Coins, Pickaxe, Send, ShieldCheck } from "lucide-react";

import { ButtonLink, Card, PageShell, Reveal, Section, StatusPill } from "../components/MarketingPrimitives";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { formatTime, formatVlq, shortHash } from "../helpers/publicApi";

function settledData(result) {
  return result.status === "fulfilled" ? result.value.data : null;
}

function unavailable(result) {
  return result.status === "rejected" || result.value?.data?.success === false;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayNumber(source, value, suffix = "") {
  if (!source || value === null || value === undefined || value === "") return "Unavailable";
  const number = numericValue(value);
  return number === null ? `${value}${suffix}` : `${number.toLocaleString(undefined, { maximumFractionDigits: 8 })}${suffix}`;
}

function statusText(source, value) {
  if (!source || value === null || value === undefined || value === "") return "Unavailable";
  return value;
}

function VLQ() {
  const { wallet, isLoggedIn } = useAuth();
  const [data, setData] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadVlqOverview() {
      setLoading(true);
      try {
        const [
          summaryResult,
          economicsResult,
          confirmedResult,
          pendingResult,
          faucetResult,
          miningResult,
          treasuryResult,
          treasuryLedgerResult,
          lendingResult,
        ] = await Promise.allSettled([
          api.get("/chain/summary"),
          api.get("/economics"),
          api.get("/transactions", { params: { status: "confirmed", limit: 6, offset: 0 } }),
          api.get("/transactions/pending", { params: { limit: 6, offset: 0 } }),
          api.get("/faucet/summary"),
          api.get("/mining/status"),
          api.get("/treasury/summary"),
          api.get("/treasury/ledger", { params: { limit: 5, offset: 0 } }),
          api.get("/lending/summary"),
        ]);

        if (!mounted) return;
        setData({
          summary: settledData(summaryResult)?.summary || null,
          economics: settledData(economicsResult) || null,
          confirmed: settledData(confirmedResult) || null,
          pending: settledData(pendingResult) || null,
          faucet: settledData(faucetResult)?.summary || null,
          mining: settledData(miningResult)?.status || settledData(miningResult) || null,
          treasury: settledData(treasuryResult)?.summary || null,
          treasuryLedger: settledData(treasuryLedgerResult) || null,
          lending: settledData(lendingResult)?.summary || null,
          unavailable: {
            summary: unavailable(summaryResult),
            economics: unavailable(economicsResult),
            confirmed: unavailable(confirmedResult),
            pending: unavailable(pendingResult),
            faucet: unavailable(faucetResult),
            mining: unavailable(miningResult),
            treasury: unavailable(treasuryResult),
            treasuryLedger: unavailable(treasuryLedgerResult),
            lending: unavailable(lendingResult),
          },
        });
        setErrorMessage("");
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Unable to load VLQ overview."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadVlqOverview();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWalletVlq() {
      if (!wallet?.address) {
        setWalletData(null);
        return;
      }

      const [balanceResult, activityResult, claimsResult] = await Promise.allSettled([
        api.get("/wallet/balance", { params: { address: wallet.address } }),
        api.get("/chain/address", { params: { address: wallet.address, limit: 8, offset: 0 } }),
        api.get("/faucet/claims", { params: { address: wallet.address } }),
      ]);

      if (!mounted) return;
      setWalletData({
        balance: settledData(balanceResult) || null,
        activity: settledData(activityResult) || null,
        claims: settledData(claimsResult)?.claims || [],
        unavailable: {
          balance: unavailable(balanceResult),
          activity: unavailable(activityResult),
          claims: unavailable(claimsResult),
        },
      });
    }

    loadWalletVlq();
    return () => {
      mounted = false;
    };
  }, [wallet?.address]);

  const economy = useMemo(() => {
    const summary = data?.summary;
    const economics = data?.economics;
    return {
      totalIssued: displayNumber(summary || economics, economics?.total_issued ?? summary?.total_issued, " VLQ"),
      maximumSupply: displayNumber(economics, economics?.maximum_supply, " VLQ"),
      currentReward: displayNumber(economics || summary, economics?.current_mining_reward ?? summary?.current_mining_reward, " VLQ"),
      height: displayNumber(summary || economics, summary?.block_height ?? economics?.current_block_height),
      halvingInterval: displayNumber(economics, economics?.halving_interval, " blocks"),
      chainStatus: statusText(summary, summary?.chain_valid === true ? "Valid" : summary?.chain_valid === false ? "Review" : null),
    };
  }, [data]);

  const pendingTransactions = data?.pending?.transactions || [];
  const confirmedTransactions = data?.confirmed?.transactions || [];
  const ledgerEntries = data?.treasuryLedger?.entries || data?.treasury?.latest_ledger_entries || [];
  const walletTransactions = walletData?.activity?.transactions || [];

  return (
    <PageShell>
      <Section className="grid gap-10">
        <Reveal className="max-w-4xl pt-6">
          <StatusPill>VLQ transparency</StatusPill>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5rem)] font-black leading-none text-white">Understand VLQ inside Vorliq.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-vorliq-muted">
            VLQ is the native coin used by Vorliq wallets, sends, mining rewards, faucet claims,
            treasury movement, lending workflows, and community voting. This page only shows data
            from existing public APIs and does not make market value or return promises.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/blockchain">Open Explorer</ButtonLink>
            <ButtonLink to="/wallet" variant="secondary">Check A Balance</ButtonLink>
            <ButtonLink to="/faucet" variant="secondary">Get Starter VLQ</ButtonLink>
          </div>
        </Reveal>

        <ErrorMessage message={errorMessage} />

        {loading ? (
          <Card className="p-6">
            <Spinner label="Loading VLQ overview..." />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="VLQ network summary">
              <Metric icon={Coins} label="Confirmed supply issued" value={economy.totalIssued} note="Computed from public chain data." />
              <Metric icon={ShieldCheck} label="Maximum supply rule" value={economy.maximumSupply} note="Read from the public economics endpoint." />
              <Metric icon={Pickaxe} label="Current mining reward" value={economy.currentReward} note={`Halving interval: ${economy.halvingInterval}.`} />
              <Metric icon={ArrowRight} label="Confirmed transactions" value={displayNumber(data?.summary || data?.confirmed, data?.summary?.total_transactions ?? data?.confirmed?.total)} />
              <Metric icon={ArrowRight} label="Pending transactions" value={displayNumber(data?.pending, data?.pending?.total)} note="Pending means waiting for a mined block." tone="gold" />
              <Metric icon={ShieldCheck} label="Chain status" value={economy.chainStatus} tone={economy.chainStatus === "Valid" ? "teal" : "gold"} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <Card className="grid content-start gap-5 p-5 md:p-6">
                <SectionHeading eyebrow="Wallet view" title={isLoggedIn ? "Your VLQ" : "Your VLQ starts with a wallet"} />
                {isLoggedIn && wallet?.address ? (
                  <>
                    <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">
                      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">Wallet address</span>
                      <strong className="mt-3 block break-all font-mono text-sm text-white">{wallet.address}</strong>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MiniStat label="Confirmed balance" value={walletData?.unavailable.balance ? "Unavailable" : displayNumber(walletData?.balance, walletData?.balance?.balance, ` ${walletData?.balance?.coin || "VLQ"}`)} />
                      <MiniStat label="Pending incoming" value={walletData?.unavailable.activity ? "Unavailable" : displayNumber(walletData?.activity, walletData?.activity?.pending_incoming_total, " VLQ")} />
                      <MiniStat label="Pending outgoing" value={walletData?.unavailable.activity ? "Unavailable" : displayNumber(walletData?.activity, walletData?.activity?.pending_outgoing_total, " VLQ")} />
                    </div>
                    <p className="text-sm leading-6 text-vorliq-muted">
                      Confirmed balance is spendable on the public chain. Pending movement has been
                      submitted or queued but is not final until mined.
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <ButtonLink to="/send" variant="secondary">Send VLQ</ButtonLink>
                      <ButtonLink to={`/faucet?address=${encodeURIComponent(wallet.address)}`} variant="secondary">Open Faucet</ButtonLink>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-vorliq-gold/40 bg-vorliq-gold/10 p-5">
                      <strong className="text-white">No unlocked wallet in this browser session.</strong>
                      <p className="mt-2 leading-7 text-vorliq-muted">
                        Create or import an encrypted Vorliq wallet to see your confirmed balance,
                        pending movement, faucet claims, and recent wallet activity here.
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <ButtonLink to="/register">Create Account</ButtonLink>
                      <ButtonLink to="/login" variant="secondary">Sign In</ButtonLink>
                    </div>
                  </>
                )}
              </Card>

              <Card className="grid content-start gap-5 p-5 md:p-6">
                <SectionHeading eyebrow="How movement confirms" title="Pending to confirmed" />
                <FlowStep icon={Send} title="1. Submit or queue" body="A send, faucet payout, lending issue, treasury payout, or mining reward starts as a pending transaction when the public API accepts or creates it." />
                <FlowStep icon={Pickaxe} title="2. Mine a block" body="Mining collects pending transactions into a proof-of-work block. Reward transactions are also queued for later confirmation." />
                <FlowStep icon={ShieldCheck} title="3. Inspect confirmation" body="The explorer shows confirmed transaction records, block links, confirmations, sender, receiver, amount, and public status." />
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="grid content-start gap-4 p-5">
                <SectionHeading eyebrow="Starter VLQ" title="Faucet status" />
                <MiniStat label="Starter amount" value={displayNumber(data?.faucet, data?.faucet?.starter_amount, " VLQ")} />
                <MiniStat label="Treasury available" value={displayNumber(data?.faucet, data?.faucet?.treasury_balance, " VLQ")} />
                <MiniStat label="Claims in 24h" value={displayNumber(data?.faucet, data?.faucet?.claims_24h)} />
                <p className="text-sm leading-6 text-vorliq-muted">
                  {data?.faucet?.next_available_hint || "Claims use public wallet addresses only and do not require private keys."}
                </p>
                <ButtonLink to="/faucet" variant="secondary">Open Faucet</ButtonLink>
              </Card>

              <Card className="grid content-start gap-4 p-5">
                <SectionHeading eyebrow="Mining" title="Reward status" />
                <MiniStat label="Miner receives" value={displayNumber(data?.mining, data?.mining?.miner_reward_after_treasury, " VLQ")} />
                <MiniStat label="Treasury receives" value={displayNumber(data?.mining, data?.mining?.treasury_reward_per_block, " VLQ")} />
                <MiniStat label="Pending user transactions" value={displayNumber(data?.mining, data?.mining?.pending_user_transaction_count)} />
                <p className="text-sm leading-6 text-vorliq-muted">
                  {data?.mining?.can_mine_now ? "Mining is available now." : data?.mining?.reason_if_not || "Mining status is loaded from the public mining endpoint."}
                </p>
                <ButtonLink to="/mine" variant="secondary">View Mining</ButtonLink>
              </Card>

              <Card className="grid content-start gap-4 p-5">
                <SectionHeading eyebrow="Community pool" title="Lending movement" />
                <MiniStat label="Pending votes" value={displayNumber(data?.lending, data?.lending?.pending_vote_count)} />
                <MiniStat label="Active VLQ" value={displayNumber(data?.lending, data?.lending?.total_vlq_active, " VLQ")} />
                <MiniStat label="Repaid VLQ" value={displayNumber(data?.lending, data?.lending?.total_vlq_repaid, " VLQ")} />
                <p className="text-sm leading-6 text-vorliq-muted">
                  Approved lending activity still needs an issuance transaction to be mined before it is confirmed.
                </p>
                <ButtonLink to="/lending" variant="secondary">View Lending</ButtonLink>
              </Card>
            </div>

            <Card className="grid gap-5 p-5 md:p-6">
              <SectionHeading eyebrow="Treasury" title="Public treasury movement" />
              <div className="grid gap-3 sm:grid-cols-4">
                <MiniStat label="Balance" value={displayNumber(data?.treasury, data?.treasury?.current_balance ?? data?.treasury?.balance, " VLQ")} />
                <MiniStat label="Total received" value={displayNumber(data?.treasury, data?.treasury?.total_received, " VLQ")} />
                <MiniStat label="Total paid" value={displayNumber(data?.treasury, data?.treasury?.total_paid, " VLQ")} />
                <MiniStat label="Pending payouts" value={displayNumber(data?.treasury, data?.treasury?.pending_payouts, " VLQ")} />
              </div>
              <RecordList
                empty={data?.unavailable.treasuryLedger ? "Treasury ledger is unavailable from the public API right now." : "No treasury ledger entries are available yet."}
                items={ledgerEntries}
                render={(entry) => <TreasuryLedgerRow entry={entry} key={entry.ledger_id || entry.tx_id} />}
              />
              <ButtonLink to="/treasury" variant="secondary">Open Treasury</ButtonLink>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="grid content-start gap-4 p-5 md:p-6">
                <SectionHeading eyebrow="Pending pool" title="Waiting for a block" />
                <RecordList
                  empty={data?.unavailable.pending ? "Pending transactions are unavailable right now." : "No pending transactions are waiting right now."}
                  items={pendingTransactions}
                  render={(transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />}
                />
              </Card>
              <Card className="grid content-start gap-4 p-5 md:p-6">
                <SectionHeading eyebrow="Confirmed on-chain" title="Recent VLQ transactions" />
                <RecordList
                  empty={data?.unavailable.confirmed ? "Confirmed transactions are unavailable right now." : "No confirmed transactions are available yet."}
                  items={confirmedTransactions}
                  render={(transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />}
                />
              </Card>
            </div>

            {isLoggedIn && wallet?.address && (
              <Card className="grid gap-5 p-5 md:p-6">
                <SectionHeading eyebrow="Wallet activity" title="Recent activity for your wallet" />
                <RecordList
                  empty={walletData?.unavailable.activity ? "Wallet activity is unavailable right now." : "No public activity found for this wallet yet."}
                  items={walletTransactions}
                  render={(transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />}
                />
                {walletData?.claims?.length > 0 && (
                  <div className="grid gap-3">
                    <h3 className="text-xl font-black text-white">Faucet claims for this wallet</h3>
                    {walletData.claims.slice(0, 4).map((claim) => (
                      <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4" key={claim.claim_id}>
                        <StatusPill tone={claim.status === "confirmed" ? "teal" : "gold"}>{claim.status || "pending"}</StatusPill>
                        <strong className="mt-3 block text-white">{formatVlq(claim.amount)}</strong>
                        {claim.tx_id ? <Link className="mt-2 inline-block break-all font-mono text-sm font-black text-vorliq-accent" to={`/tx/${claim.tx_id}`}>{shortHash(claim.tx_id)}</Link> : <p className="mt-2 text-sm text-vorliq-muted">No transaction yet.</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </Section>
    </PageShell>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <div>
      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">{eyebrow}</span>
      <h2 className="mt-2 text-2xl font-black text-white">{title}</h2>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, tone = "teal" }) {
  return (
    <Card className="grid min-h-[180px] content-start gap-4 p-5">
      <span className={`grid h-11 w-11 place-items-center rounded-lg border ${tone === "gold" ? "border-vorliq-gold/40 bg-vorliq-gold/10 text-vorliq-gold" : "border-vorliq-accent/40 bg-vorliq-accent/10 text-vorliq-accent"}`}>
        <Icon size={22} aria-hidden="true" />
      </span>
      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">{label}</span>
      <strong className="break-words font-mono text-2xl text-white">{value}</strong>
      {note && <p className="text-sm leading-6 text-vorliq-muted">{note}</p>}
    </Card>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">{label}</span>
      <strong className="mt-2 block break-words font-mono text-lg text-white">{value}</strong>
    </div>
  );
}

function FlowStep({ icon: Icon, title, body }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-vorliq-border bg-white/[0.04] text-vorliq-accent">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div>
        <h3 className="font-black text-white">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-vorliq-muted">{body}</p>
      </div>
    </div>
  );
}

function RecordList({ items, empty, render }) {
  if (!items?.length) {
    return <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-5 font-semibold text-vorliq-muted">{empty}</div>;
  }
  return <div className="grid gap-3">{items.map(render)}</div>;
}

function TransactionRow({ transaction }) {
  const status = String(transaction.status || "confirmed").toLowerCase();
  const txId = transaction.tx_id || transaction.id;
  const sender = transaction.sender_address || transaction.sender;
  const receiver = transaction.receiver_address || transaction.recipient;
  const content = (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <StatusPill tone={status === "pending" ? "gold" : "teal"}>{status === "pending" ? "Pending" : "Confirmed"}</StatusPill>
        <span className="font-mono text-sm font-black text-vorliq-muted">{formatVlq(transaction.amount)}</span>
      </div>
      <strong className="mt-3 block break-all font-mono text-sm text-white">{shortHash(txId)}</strong>
      <span className="mt-2 block break-all font-mono text-xs text-vorliq-muted">From {shortHash(sender)}</span>
      <span className="mt-1 block break-all font-mono text-xs text-vorliq-muted">To {shortHash(receiver)}</span>
      {transaction.block_index !== null && transaction.block_index !== undefined && (
        <span className="mt-2 block text-xs font-bold text-vorliq-muted">Block #{transaction.block_index}</span>
      )}
    </>
  );

  if (!txId) {
    return <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">{content}</div>;
  }

  return (
    <Link className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4 transition hover:border-vorliq-accent" to={`/tx/${encodeURIComponent(txId)}`}>
      {content}
    </Link>
  );
}

function TreasuryLedgerRow({ entry }) {
  return (
    <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <StatusPill tone={entry.type === "reward_in" ? "teal" : "gold"}>{entry.type === "reward_in" ? "Reward in" : "Payout"}</StatusPill>
        <span className="font-mono text-sm font-black text-vorliq-muted">{formatVlq(entry.amount)}</span>
      </div>
      <strong className="mt-3 block text-white">{entry.description || "Treasury ledger entry"}</strong>
      <span className="mt-2 block break-all font-mono text-xs text-vorliq-muted">
        {shortHash(entry.from_address)} to {shortHash(entry.to_address)}
      </span>
      <span className="mt-1 block text-xs font-bold text-vorliq-muted">{formatTime(entry.timestamp)}</span>
      {entry.tx_id && <Link className="mt-2 inline-block break-all font-mono text-sm font-black text-vorliq-accent" to={`/tx/${entry.tx_id}`}>View {shortHash(entry.tx_id)}</Link>}
    </div>
  );
}

export default VLQ;
