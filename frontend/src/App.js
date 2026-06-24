import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AnalyticsRouteTracker from "./components/AnalyticsRouteTracker";
import BrandBackground from "./components/BrandBackground";
import ErrorBoundary from "./components/ErrorBoundary";
import BrandLoader from "./components/BrandLoader";
import IncidentBanner from "./components/IncidentBanner";
import { ProductFooter, ProductNav } from "./components/ProductShell";
import ProtectedRoute from "./components/ProtectedRoute";
import { initAnalytics } from "./helpers/analytics";
import { captureReferrerFromUrl } from "./helpers/referral";
import { applyTheme, getStoredTheme } from "./helpers/theme";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { SessionProvider } from "./context/SessionContext";
import { WalletBalanceProvider } from "./context/WalletBalanceContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Features from "./pages/Features";
import CommunityTreasury from "./pages/CommunityTreasury";
import NotFound from "./pages/NotFound";
const Account = lazy(() => import("./pages/Account"));
const Achievements = lazy(() => import("./pages/Achievements"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const Ambassador = lazy(() => import("./pages/Ambassador"));
const Audit = lazy(() => import("./pages/Audit"));
const Blockchain = lazy(() => import("./pages/Blockchain"));
const BlockDetail = lazy(() => import("./pages/BlockDetail"));
const Community = lazy(() => import("./pages/Community"));
const Bootstrap = lazy(() => import("./pages/Bootstrap"));
const Chat = lazy(() => import("./pages/Chat"));
const Exchange = lazy(() => import("./pages/Exchange"));
const Forum = lazy(() => import("./pages/Forum"));
const Growth = lazy(() => import("./pages/Growth"));
const Health = lazy(() => import("./pages/Health"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const MigrationReadiness = lazy(() => import("./pages/MigrationReadiness"));
const Network = lazy(() => import("./pages/Network"));
const NodeSync = lazy(() => import("./pages/NodeSync"));
const Notifications = lazy(() => import("./pages/Notifications"));
const PeerPropagation = lazy(() => import("./pages/PeerPropagation"));
const Price = lazy(() => import("./pages/Price"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Profile = lazy(() => import("./pages/Profile"));
const Terms = lazy(() => import("./pages/Terms"));
const Readiness = lazy(() => import("./pages/Readiness"));
const Registry = lazy(() => import("./pages/Registry"));
const Releases = lazy(() => import("./pages/Releases"));
const Roadmap = lazy(() => import("./pages/Roadmap"));
const Snapshot = lazy(() => import("./pages/Snapshot"));
const SnapshotArchive = lazy(() => import("./pages/SnapshotArchive"));
const Stats = lazy(() => import("./pages/Stats"));
const Status = lazy(() => import("./pages/Status"));
const TransactionDetail = lazy(() => import("./pages/TransactionDetail"));
const Transparency = lazy(() => import("./pages/Transparency"));
const Treasury = lazy(() => import("./pages/Treasury"));
const VLQ = lazy(() => import("./pages/VLQ"));
const Whitepaper = lazy(() => import("./pages/Whitepaper"));
// New design layer (migrated page-by-page). Brings its own nav/footer.
const Landing = lazy(() => import("./pages/vnext/Landing"));
const VnextDashboard = lazy(() => import("./pages/vnext/Dashboard"));
const VnextWallet = lazy(() => import("./pages/vnext/Wallet"));
const VnextSend = lazy(() => import("./pages/vnext/Send"));
const VnextReceive = lazy(() => import("./pages/vnext/Receive"));
const VnextMining = lazy(() => import("./pages/vnext/Mining"));
const VnextLending = lazy(() => import("./pages/vnext/Lending"));
const VnextGovernance = lazy(() => import("./pages/vnext/Governance"));
const VnextFaucet = lazy(() => import("./pages/vnext/Faucet"));
const VnextSettings = lazy(() => import("./pages/vnext/Settings"));

const primaryLinks = [
  { to: "/", label: "Home", end: true },
  { to: "/features", label: "Features" },
  { to: "/blockchain", label: "Blockchain" },
  { to: "/dashboard", label: "Dashboard" },
];

const moreLinks = [
  { to: "/wallet", label: "Wallet" },
  { to: "/send", label: "Send" },
  { to: "/lending", label: "Lending" },
  { to: "/governance", label: "Governance" },
  { to: "/transparency", label: "Transparency" },
];

const navSections = [
  {
    title: "Product",
    links: primaryLinks,
  },
  {
    title: "Community",
    links: [
      { to: "/forum", label: "Forum" },
      { to: "/chat", label: "Chat" },
      { to: "/profile", label: "Profiles" },
    ],
  },
  {
    title: "Network",
    links: [
      { to: "/blockchain", label: "Blockchain" },
      { to: "/network", label: "Network" },
      { to: "/registry", label: "Registry" },
      { to: "/nodes/compare", label: "Node Sync" },
      { to: "/peers/propagation", label: "Peer Propagation" },
    ],
  },
];

// Primary routes now served by the new design layer (vnext). These pages bring
// their own nav (landing TopNav) or app shell (sidebar/tab bar) and theme-aware
// background, so the global brand chrome is suppressed for them — exactly as it
// already was for the /preview/* staging routes.
const VNEXT_PRIMARY_ROUTES = new Set([
  "/",
  "/dashboard",
  "/wallet",
  "/send",
  "/receive",
  "/mine",
  "/lending",
  "/governance",
  "/faucet",
  "/settings",
]);

// Standalone vnext routes render their own <main id="main-content"> (inside the
// landing layout or the app shell), with nav/footer kept outside it. Other
// routes are wrapped in the shared main landmark here.
function MainRegion({ standalone, children }) {
  if (standalone) return children;
  return (
    <main id="main-content" tabIndex="-1">
      {children}
    </main>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <NotificationProvider>
        <AuthProvider>
          <WalletBalanceProvider>
            <RealtimeProvider>
              <BrowserRouter>
                <SessionProvider>
                  <AppShell />
                </SessionProvider>
              </BrowserRouter>
            </RealtimeProvider>
          </WalletBalanceProvider>
        </AuthProvider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

function AppShell() {
  const location = useLocation();
  // The new design layer ships its own nav, footer, and background, so the
  // global brand chrome is suppressed for the flipped primary vnext routes.
  const standalone = VNEXT_PRIMARY_ROUTES.has(location.pathname);

  useEffect(() => {
    applyTheme(getStoredTheme());
    // Remember an invite referrer if the visitor arrived via an invite link.
    captureReferrerFromUrl();
    return initAnalytics();
  }, []);

  return (
    <div className="app-shell">
      {/* The global ProductNav carries the skip link; standalone (vnext) routes
          suppress it, so provide an equivalent skip link for keyboard users. */}
      {standalone && (
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[1200] focus:rounded-lg focus:bg-vorliq-accent focus:px-4 focus:py-3 focus:font-black focus:text-[#06101c]"
          href="#main-content"
        >
          Skip to main content
        </a>
      )}
      {!standalone && <BrandBackground />}
      {!standalone && <ProductNav />}
      {!standalone && <IncidentBanner />}
      <AnalyticsRouteTracker />
      <MainRegion standalone={standalone}>
        <Suspense fallback={<div className="page"><BrandLoader label="Loading Vorliq" /></div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<VnextDashboard />} />
          <Route path="/features" element={<Features />} />
          <Route path="/vlq" element={<VLQ />} />
          <Route path="/wallet" element={<VnextWallet />} />
          <Route path="/send" element={<VnextSend />} />
          <Route path="/receive" element={<VnextReceive />} />
          <Route path="/blockchain" element={<Blockchain />} />
          <Route path="/tx/:txId" element={<TransactionDetail />} />
          <Route path="/block/:blockId" element={<BlockDetail />} />
          <Route path="/mine" element={<VnextMining />} />
          <Route path="/whitepaper" element={<Whitepaper />} />
          <Route path="/network" element={<Network />} />
          <Route path="/lending" element={<VnextLending />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/governance" element={<VnextGovernance />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/community-treasury" element={<CommunityTreasury />} />
          <Route path="/faucet" element={<VnextFaucet />} />
          <Route path="/price" element={<Price />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/ambassador" element={<Ambassador />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/status" element={<Status />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/nodes/compare" element={<NodeSync />} />
          <Route path="/peers/propagation" element={<PeerPropagation />} />
          <Route path="/health" element={<Health />} />
          <Route path="/growth" element={<Growth />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/settings" element={<VnextSettings />} />
          <Route path="/releases" element={<Releases />} />
          <Route path="/readiness" element={<Readiness />} />
          <Route path="/migration-readiness" element={<MigrationReadiness />} />
          <Route path="/snapshot" element={<Snapshot />} />
          <Route path="/snapshot-archive" element={<SnapshotArchive />} />
          <Route path="/bootstrap" element={<Bootstrap />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/community" element={<Community />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/:address" element={<Profile />} />
          <Route path="/profiles" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/analytics" element={<AdminAnalytics />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <Account />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </MainRegion>
      {!standalone && <ProductFooter />}
      <ToastContainer
        className="toast"
        position="top-right"
        theme="dark"
        autoClose={3600}
        closeOnClick
        pauseOnHover
      />
    </div>
  );
}

export { moreLinks, navSections, primaryLinks };
export default App;
