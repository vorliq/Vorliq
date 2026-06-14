# Market-Access Readiness — Gap Report

Status: internal planning notes. Report only — no listing applications have been
made, no exchanges contacted, and nothing here implies Vorliq is ready to list.
Roadmap item 5 mentions pursuing aggregator/exchange listings "when ready"; this
maps the common requirements to what exists today versus what is missing.

Date of assessment: 2026-06-14. Figures are read from the live public API
(`/api/economics`, `/api/chain/summary`, `/api/registry/summary`).

## Two different tracks (do not conflate them)

1. **Data aggregators** (e.g. CoinGecko, CoinMarketCap): list assets that are
   *already trading* on a tracked market. Their gating requirement is a real,
   liquid trading venue plus verifiable supply and explorer data. They do not
   create a market; they index existing ones.
2. **Exchanges** (e.g. MEXC and similar): actually create the trading venue.
   They require legal/compliance onboarding, technical integration, liquidity
   / market-making, and usually commercial terms. This is a much higher bar.

Vorliq is not ready for either today, primarily because VLQ does not trade
anywhere and the network is effectively single-operator. The detail below is
for planning, not action.

## Requirement-by-requirement map

| Requirement | Typical expectation | Vorliq today | Gap |
| --- | --- | --- | --- |
| Publicly verifiable supply | Max/total/circulating supply visible and reproducible | `/api/economics`: `maximum_supply` 21,000,000, `total_issued` 13,200, `current_mining_reward` 50, `halving_interval` 210,000. Matches the whitepaper. | Mostly met for max/issued. **No explicit "circulating supply" definition** (issued vs. locked/treasury). Aggregators ask for a circulating-supply methodology and often a public API field for it. |
| Public block explorer | Anyone can look up blocks, transactions, addresses | In-app explorer at `/blockchain`; public APIs `/api/chain/summary`, `/api/transactions`. | Met in substance. A dedicated explorer URL and an address-lookup page help; confirm a stable public API contract for indexers. |
| Public whitepaper / docs | Architecture, consensus, token role | `/docs/whitepaper.html` (PoW, SECP256K1, 21M cap, halving, lending/governance) plus extensive `/docs`. | Met. |
| Open-source code | Public repository, license | `github.com/vorliq/Vorliq`, MIT license. | Met. |
| Active social presence | Official channels, real activity | X (`x.com/Vorliq`), Discord, GitHub — the only official channels. | Present. Aggregators check for *activity*, not just existence. |
| Source / contract verification | For chain coins, reproducible node software; for tokens, verified contract | VLQ is a **native coin on its own chain**, not an ERC-20-style contract, so "verified contract address" does not apply. The analog — open node software + public explorer — exists. | Met in substance, but expect to *explain the model*: there is no contract address, so any form that demands one needs a written explanation. |
| Decentralization / multiple operators | More than one independent node; no single point of control | `/api/registry/summary` reports **1 active node**. | **Not met.** This is the single biggest gap. A one-operator network reads as centralized; aggregators and exchanges both weight this. Needs independent operators running and verifying nodes. |
| Trading market + liquidity | Listed on at least one venue with real volume | **None.** VLQ does not trade anywhere; there is no market price. | **Not met — blocking for aggregators.** No price feed, no order book, no volume to index. |
| Market-making | Sustained two-sided liquidity | None. | **Not met.** Exchange listings typically require a market maker or treasury-funded liquidity. |
| Legal entity / compliance | Registered entity, KYC/KYB, sometimes legal opinion on token status | Not evident in the codebase; the product is self-custody software and the Terms explicitly disclaim regulated status. | **Not assessed / likely not met.** Exchange onboarding (and a paid listing) generally needs a legal entity and compliance review. This is a business/legal task, not a code task. |
| Listing fees / commercial terms | Many exchanges charge listing + market-making fees | Out of scope of the codebase. | Business decision, not addressed here. |

## Honest summary

- **Ready now:** public verifiable supply data and API, public explorer, public
  whitepaper/docs, open-source MIT repo, official socials. The "show your chain
  is real and inspectable" requirements are in good shape.
- **Clearly not ready (and not a frontend task):**
  - No trading venue / liquidity / price — this alone blocks aggregator listing.
  - Single active node — the network is effectively centralized today.
  - No market-making, legal entity, or compliance posture established.
- **Needs definition before applying anywhere:** a documented **circulating
  supply** methodology (issued minus treasury/locked, with a public field), and
  a short written explanation that VLQ is a native chain coin (no contract
  address) for forms that assume an ERC-20-style token.

## Suggested ordering (when this becomes a priority)

1. Grow independent node operators (decentralization) — already a roadmap theme;
   it is also the highest-leverage market-access signal and is purely technical.
2. Define and publish circulating-supply methodology + a stable public
   supply/explorer API contract that an indexer could consume.
3. Resolve the business/legal track (entity, compliance) — out of scope here.
4. Only then consider a venue/liquidity strategy; a market must exist before any
   aggregator will index VLQ.

Nothing in this document should be read as Vorliq being ready to list, or as a
commitment to list. It is a planning gap report.
