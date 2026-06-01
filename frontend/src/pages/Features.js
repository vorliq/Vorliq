import { Blocks, Eye, HandCoins, Landmark, ShieldCheck, Users, Vote } from "lucide-react";
import { Link } from "react-router-dom";

import { ButtonLink, Card, PageShell, Reveal, Section, StatusPill } from "../components/MarketingPrimitives";

const pillars = [
  {
    title: "Savings",
    icon: HandCoins,
    body:
      "Communities can pool VLQ and keep a transparent record of movement. Vorliq does not promise financial returns or present savings as deposits.",
  },
  {
    title: "Lending",
    icon: Landmark,
    body:
      "Members can propose loans and vote according to community rules. Lending activity is traceable on chain, while each group remains responsible for its own decisions.",
  },
  {
    title: "Blockchain",
    icon: Blocks,
    body:
      "VLQ runs on Vorliq's own lightweight blockchain. Wallets, transactions, and validation stay within the Vorliq network.",
  },
  {
    title: "Community",
    icon: Users,
    body:
      "Vorliq is designed for neighbourhoods, families, cooperatives, and local groups that want shared coordination without a corporate owner.",
  },
  {
    title: "Governance",
    icon: Vote,
    body:
      "Supported settings and community proposals can be voted on openly. Governance is a software feature, not a legal wrapper or guarantee.",
  },
  {
    title: "Transparency",
    icon: Eye,
    body:
      "Blocks, transactions, node readiness, releases, and public documentation give members a shared record they can inspect.",
  },
];

function Features() {
  return (
    <PageShell>
      <Section className="grid gap-10">
        <Reveal className="max-w-4xl pt-6">
          <StatusPill>Responsible community finance software</StatusPill>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5rem)] font-black leading-none text-white">Savings, lending, and shared records for real communities.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-vorliq-muted">
            Vorliq is a community savings and lending platform built on its own lightweight blockchain. The internal coin is VLQ.
          </p>
        </Reveal>

        <div className="grid gap-5 lg:grid-cols-3">
          {pillars.map((pillar, index) => {
            const Icon = pillar.icon;
            return (
              <Reveal delay={index * 0.04} key={pillar.title}>
                <Card className="grid min-h-[260px] content-start gap-5 p-6">
                  <span className="grid h-12 w-12 place-items-center rounded-lg border border-vorliq-border bg-vorliq-accent/10 text-vorliq-accent">
                    <Icon size={24} aria-hidden="true" />
                  </span>
                  <h2 className="text-2xl font-black text-white">{pillar.title}</h2>
                  <p className="leading-7 text-vorliq-muted">{pillar.body}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </Section>

      <Section className="grid gap-8 pt-0 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <Reveal>
          <h2 className="text-[clamp(2rem,5vw,3.4rem)] font-black leading-tight text-white">What Vorliq is not</h2>
          <p className="mt-4 text-lg leading-8 text-vorliq-muted">
            Responsible wording matters. Vorliq describes itself as experimental community software, not as regulated financial services or a promise of value.
          </p>
        </Reveal>
        <Card className="grid gap-4 p-6">
          {[
            "Native Vorliq wallet flow.",
            "No third party blockchain dependency.",
            "No promise of financial returns.",
            "No request for users to paste private keys into public forms.",
          ].map((item) => (
            <div className="flex items-start gap-3 rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4" key={item}>
              <ShieldCheck className="mt-0.5 shrink-0 text-vorliq-accent" size={20} aria-hidden="true" />
              <span className="font-bold text-vorliq-muted">{item}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section className="pt-0">
        <Card className="grid gap-6 p-8 md:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-3xl font-black text-white">Explore the public chain.</h2>
            <p className="mt-3 max-w-2xl leading-7 text-vorliq-muted">
              View live blocks, transactions, and chain status through the existing public API.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/blockchain">Open Blockchain</ButtonLink>
            <Link className="inline-flex items-center justify-center rounded-full border border-vorliq-border px-5 py-3 text-sm font-black text-white" to="/register">
              Create Account
            </Link>
          </div>
        </Card>
      </Section>
    </PageShell>
  );
}

export default Features;
