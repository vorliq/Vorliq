import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AnalyticsRouteTracker from "./components/AnalyticsRouteTracker";
import BrandBackground from "./components/BrandBackground";
import BrandLoader from "./components/BrandLoader";
import IncidentBanner from "./components/IncidentBanner";
import { ProductFooter, ProductNav } from "./components/ProductShell";
import ProtectedRoute from "./components/ProtectedRoute";
import { initAnalytics } from "./helpers/analytics";
import { applyTheme, getStoredTheme } from "./helpers/theme";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Features from "./pages/Features";
const Account = lazy(() => import("./pages/Account"));
const Achievements = lazy(() => import("./pages/Achievements"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const Ambassador = lazy(() => import("./pages/Ambassador"));
const Audit = lazy(() => import("./pages/Audit"));
const Blockchain = lazy(() => import("./pages/Blockchain"));
const BlockDetail = lazy(() => import("./pages/BlockDetail"));
const Bootstrap = lazy(() => import("./pages/Bootstrap"));
const Chat = lazy(() => import("./pages/Chat"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Exchange = lazy(() => import("./pages/Exchange"));
const Faucet = lazy(() => import("./pages/Faucet"));
const Forum = lazy(() => import("./pages/Forum"));
const Governance = lazy(() => import("./pages/Governance"));
const Growth = lazy(() => import("./pages/Growth"));
const Health = lazy(() => import("./pages/Health"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Lending = lazy(() => import("./pages/Lending"));
const MigrationReadiness = lazy(() => import("./pages/MigrationReadiness"));
const Mine = lazy(() => import("./pages/Mine"));
const Network = lazy(() => import("./pages/Network"));
const NodeSync = lazy(() => import("./pages/NodeSync"));
const Notifications = lazy(() => import("./pages/Notifications"));
const PeerPropagation = lazy(() => import("./pages/PeerPropagation"));
const Price = lazy(() => import("./pages/Price"));
const Profile = lazy(() => import("./pages/Profile"));
const Readiness = lazy(() => import("./pages/Readiness"));
const Registry = lazy(() => import("./pages/Registry"));
const Releases = lazy(() => import("./pages/Releases"));
const Roadmap = lazy(() => import("./pages/Roadmap"));
const Settings = lazy(() => import("./pages/Settings"));
const Send = lazy(() => import("./pages/Send"));
const Snapshot = lazy(() => import("./pages/Snapshot"));
const SnapshotArchive = lazy(() => import("./pages/SnapshotArchive"));
const Stats = lazy(() => import("./pages/Stats"));
const Status = lazy(() => import("./pages/Status"));
const TransactionDetail = lazy(() => import("./pages/TransactionDetail"));
const Transparency = lazy(() => import("./pages/Transparency"));
const Treasury = lazy(() => import("./pages/Treasury"));
const VLQ = lazy(() => import("./pages/VLQ"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Whitepaper = lazy(() => import("./pages/Whitepaper"));
// New design layer (migrated page-by-page). Brings its own nav/footer.
const Landing = lazy(() => import("./pages/vnext/Landing"));

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

function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

function AppShell() {
  const location = useLocation();
  // The new design layer ("/preview/*") ships its own nav, footer, and
  // background, so the global brand chrome is suppressed for those routes.
  const standalone = location.pathname.startsWith("/preview");

  useEffect(() => {
    applyTheme(getStoredTheme());
    return initAnalytics();
  }, []);

  return (
    <div className="app-shell">
      {!standalone && <BrandBackground />}
      {!standalone && <ProductNav />}
      {!standalone && <IncidentBanner />}
      <AnalyticsRouteTracker />
      <main id="main-content" tabIndex="-1">
        <Suspense fallback={<div className="page"><BrandLoader label="Loading Vorliq" /></div>}>
        <Routes>
          <Route path="/preview" element={<Landing />} />
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/features" element={<Features />} />
          <Route path="/vlq" element={<VLQ />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/send" element={<Send />} />
          <Route path="/blockchain" element={<Blockchain />} />
          <Route path="/tx/:txId" element={<TransactionDetail />} />
          <Route path="/block/:blockId" element={<BlockDetail />} />
          <Route path="/mine" element={<Mine />} />
          <Route path="/whitepaper" element={<Whitepaper />} />
          <Route path="/network" element={<Network />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/faucet" element={<Faucet />} />
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
          <Route path="/settings" element={<Settings />} />
          <Route path="/releases" element={<Releases />} />
          <Route path="/readiness" element={<Readiness />} />
          <Route path="/migration-readiness" element={<MigrationReadiness />} />
          <Route path="/snapshot" element={<Snapshot />} />
          <Route path="/snapshot-archive" element={<SnapshotArchive />} />
          <Route path="/bootstrap" element={<Bootstrap />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/profile" element={<Profile />} />
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
        </Routes>
        </Suspense>
      </main>
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
