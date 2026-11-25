import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Meeting from './pages/Meeting.jsx';
import MeetingDetails from './pages/MeetingDetails.jsx';
import Profile from './pages/Profile.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center-screen"><p className="muted">Loading…</p></div>;
  return user ? children : <Navigate to="/login" state={{ from: loc.pathname }} replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center-screen"><p className="muted">Loading…</p></div>;
  return user ? <Navigate to={loc.state?.from || '/'} replace /> : <AuthPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/meeting/:code" element={<Protected><Meeting /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/history/:code" element={<Protected><MeetingDetails /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
