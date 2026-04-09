import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import DashboardPage from './pages/Dashboard';
import OrganizationPage from './pages/Organization';
import ApprovalPage from './pages/Approval';
import MessengerPage from './pages/Messenger';
import CCTVPage from './pages/CCTV';
import AttendancePage from './pages/Attendance';
import CalendarPage from './pages/CalendarPage';
import BoardPage from './pages/Board';
import TaskOrdersPage from './pages/TaskOrders';
import InventoryPage from './pages/Inventory';
import MeetingPage from './pages/Meeting';
import MeetingRoom from './pages/MeetingRoom';
import DocumentsPage from './pages/Documents';
import AdminConsolePage from './pages/AdminConsole';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected — fullscreen (no Layout) */}
        <Route path="/meeting/room/:roomId" element={
          <ProtectedRoute><MeetingRoom /></ProtectedRoute>
        } />

        {/* Protected — with Layout */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/organization" element={<OrganizationPage />} />
          <Route path="/approval" element={<ApprovalPage />} />
          <Route path="/messenger" element={<MessengerPage />} />
          <Route path="/cctv" element={<CCTVPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/task-orders" element={<TaskOrdersPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/meeting" element={<MeetingPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/admin" element={<AdminConsolePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
