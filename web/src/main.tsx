import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { StoryProvider } from "./components/Story";
import { AppShell } from "./components/AppShell";
import { BoardPage } from "./pages/BoardPage";
import { PocDetailPage } from "./pages/PocDetailPage";
import { IntakePage } from "./pages/IntakePage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { HandoffPage } from "./pages/HandoffPage";
import { SettingsPage } from "./pages/SettingsPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoryProvider>
        <Routes>
          {/* Customer-facing journey (no operator chrome). */}
          <Route path="/approval" element={<ApprovalPage />} />
          <Route path="/handoff/:pocId" element={<HandoffPage />} />

          {/* Operator console. */}
          <Route element={<AppShell />}>
            <Route path="/" element={<BoardPage />} />
            <Route path="/intake" element={<IntakePage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/poc/:pocId" element={<PocDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </StoryProvider>
    </BrowserRouter>
  </StrictMode>,
);
