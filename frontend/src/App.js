import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AnalyticsRouteTracker from "./components/AnalyticsRouteTracker";
import IncidentBanner from "./components/IncidentBanner";
import { ProductFooter, ProductNav } from "./components/ProductShell";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import Account from "./pages/Account";
import Achievements from "./pages/Achievements";
import Admin from "./pages/Admin";
import Ambassador from "./pages/Ambassador";
import Audit from "./pages/Audit";
import Blockchain from "./pages/Blockchain";
import BlockDetail from "./pages/BlockDetail";
import Bootstrap from "./pages/Bootstrap";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import Exchange from "./pages/Exchange";
import Faucet from "./pages/Faucet";
import Features from "./pages/Features";
import Forum from "./pages/Forum";
import Governance from "./pages/Governance";
import Growth from "./pages/Growth";
import Health from "./pages/Health";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import Lending from "./pages/Lending";
import Login from "./pages/Login";
import MigrationReadiness from "./pages/MigrationReadiness";
import Mine from "./pages/Mine";
import Network from "./pages/Network";
import NodeSync from "./pages/NodeSync";
import Notifications from "./pages/Notifications";
import PeerPropagation from "./pages/PeerPropagation";
import Price from "./pages/Price";
import Profile from "./pages/Profile";
import Readiness from "./pages/Readiness";
import Register from "./pages/Register";
import Registry from "./pages/Registry";
import Releases from "./pages/Releases";
import Roadmap from "./pages/Roadmap";
import Send from "./pages/Send";
import Snapshot from "./pages/Snapshot";
import SnapshotArchive from "./pages/SnapshotArchive";
import Stats from "./pages/Stats";
import TransactionDetail from "./pages/TransactionDetail";
import Transparency from "./pages/Transparency";
import Treasury from "./pages/Treasury";
import VLQ from "./pages/VLQ";
import Wallet from "./pages/Wallet";
import Whitepaper from "./pages/Whitepaper";

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
  return (
    <div className="min-h-screen bg-[#0A0E1A] text-white">
      <ProductNav />
      <IncidentBanner />
      <AnalyticsRouteTracker />
      <main id="main-content" tabIndex="-1">
        <Routes>
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
          <Route path="/registry" element={<Registry />} />
          <Route path="/nodes/compare" element={<NodeSync />} />
          <Route path="/peers/propagation" element={<PeerPropagation />} />
          <Route path="/health" element={<Health />} />
          <Route path="/growth" element={<Growth />} />
          <Route path="/roadmap" element={<Roadmap />} />
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
      </main>
      <ProductFooter />
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
