import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import GlobalBackground from './components/GlobalBackground';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Overview from './pages/Overview';
import Inspector from './pages/Inspector';
import Playground from './pages/Playground';
import Architecture from './pages/Architecture';
import AccountSettings from './pages/AccountSettings';
import Policies from './pages/Policies';
import EvidenceExplorer from './pages/EvidenceExplorer';
import DecisionTraces from './pages/DecisionTraces';
import Benchmarks from './pages/Benchmarks';
import Analytics from './pages/Analytics';
import Integrations from './pages/Integrations';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

export default function App() {
  return (
    <ThemeProvider>
      <GlobalBackground />
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            {/* Public Authentication Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Authenticated Workspace Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              {/* Workspace */}
              <Route index element={<Overview />} />
              <Route path="playground" element={<Playground />} />
              <Route path="inspector" element={<Inspector />} />
              <Route path="inspector/:id" element={<Inspector />} />
              <Route path="inspector/:id/claims/:claimId" element={<Inspector />} />

              {/* Intelligence */}
              <Route path="policies" element={<Policies />} />
              <Route path="evidence" element={<EvidenceExplorer />} />
              <Route path="traces" element={<DecisionTraces />} />

              {/* Performance */}
              <Route path="benchmarks" element={<Benchmarks />} />
              <Route path="analytics" element={<Analytics />} />

              {/* Platform */}
              <Route path="architecture" element={<Architecture />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="settings" element={<AccountSettings />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
