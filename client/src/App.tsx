import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout, PublicLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import { homePathFor } from './utils/format';
import Landing from './pages/public/Landing';
import About from './pages/public/About';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import SmsFallback from './pages/public/SmsFallback';

const L = (f: () => Promise<{ default: React.ComponentType<never> }>) => lazy(f as () => Promise<{ default: React.ComponentType }>);
const CitizenDashboard = L(() => import('./pages/citizen/Dashboard'));
const SosForm = L(() => import('./pages/citizen/SosForm'));
const ReportForm = L(() => import('./pages/citizen/ReportForm'));
const MyRequests = L(() => import('./pages/citizen/MyRequests'));
const RequestDetail = L(() => import('./pages/citizen/RequestDetail'));
const LiveMap = lazy(() => import('./pages/shared/LiveMap'));
const ShelterDirectory = L(() => import('./pages/shared/Shelters'));
const RoadsPage = L(() => import('./pages/shared/Roads'));
const Notifications = L(() => import('./pages/shared/Notifications'));
const Profile = L(() => import('./pages/shared/Profile'));
const ResponderAssigned = L(() => import('./pages/responder/Assigned'));
const ResponderDetail = L(() => import('./pages/responder/EmergencyDetail'));
const ResponderTeam = L(() => import('./pages/responder/Team'));
const AdminDashboard = L(() => import('./pages/admin/Dashboard'));
const AdminEmergencies = L(() => import('./pages/admin/Emergencies'));
const AdminEmergencyDetail = L(() => import('./pages/admin/EmergencyDetail'));
const AdminAutomation = L(() => import('./pages/admin/Automation'));
const AdminEscalations = L(() => import('./pages/admin/Escalations'));
const AdminDuplicates = L(() => import('./pages/admin/Duplicates'));
const AdminTeams = L(() => import('./pages/admin/Teams'));
const AdminUsers = L(() => import('./pages/admin/Users'));
const AdminVerification = L(() => import('./pages/admin/Verification'));
const AdminAudit = L(() => import('./pages/admin/Audit'));
const AdminSettings = L(() => import('./pages/admin/Settings'));
const ShelterProfile = lazy(() => import('./pages/shelter/Profile'));
const ShelterOccupancy = L(() => import('./pages/shelter/Occupancy'));
const FoodInventory = lazy(() => import('./pages/food/Inventory'));
const FoodRequests = L(() => import('./pages/food/Requests'));

function NotFound() {
  const { user } = useAuth();
  return <div className="p-10 text-center"><h1 className="text-2xl font-bold">404</h1><a className="underline" href={user ? homePathFor(user.role) : '/'}>←</a></div>;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/emergency-sms" element={<SmsFallback />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/profile" element={<Profile />} />
            <Route path="/notifications" element={<Notifications />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['citizen']} />}>
          <Route element={<AppLayout />}>
            <Route path="/citizen" element={<CitizenDashboard />} />
            <Route path="/citizen/sos" element={<SosForm />} />
            <Route path="/citizen/report" element={<ReportForm />} />
            <Route path="/citizen/requests" element={<MyRequests />} />
            <Route path="/citizen/requests/:id" element={<RequestDetail />} />
            <Route path="/citizen/map" element={<LiveMap />} />
            <Route path="/citizen/shelters" element={<ShelterDirectory />} />
            <Route path="/citizen/roads" element={<RoadsPage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['volunteer', 'team_leader']} />}>
          <Route element={<AppLayout />}>
            <Route path="/responder" element={<ResponderAssigned />} />
            <Route path="/responder/emergencies/:id" element={<ResponderDetail />} />
            <Route path="/responder/team" element={<ResponderTeam />} />
            <Route path="/responder/map" element={<LiveMap />} />
            <Route path="/responder/roads" element={<RoadsPage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route element={<AppLayout />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/emergencies" element={<AdminEmergencies />} />
            <Route path="/admin/emergencies/:id" element={<AdminEmergencyDetail />} />
            <Route path="/admin/automation" element={<AdminAutomation />} />
            <Route path="/admin/escalations" element={<AdminEscalations />} />
            <Route path="/admin/duplicates" element={<AdminDuplicates />} />
            <Route path="/admin/teams" element={<AdminTeams />} />
            <Route path="/admin/verification" element={<AdminVerification />} />
            <Route path="/admin/roads" element={<RoadsPage />} />
            <Route path="/admin/shelters" element={<ShelterProfile admin />} />
            <Route path="/admin/food" element={<FoodRequests />} />
            <Route path="/admin/food/supplies" element={<FoodInventory admin />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/map" element={<LiveMap emergencyPath="/admin/emergencies" />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['food_provider']} />}>
          <Route element={<AppLayout />}>
            <Route path="/food" element={<FoodInventory />} />
            <Route path="/food/requests" element={<FoodRequests />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['shelter_coordinator']} />}>
          <Route element={<AppLayout />}>
            <Route path="/shelter" element={<ShelterProfile />} />
            <Route path="/shelter/occupancy" element={<ShelterOccupancy />} />
          </Route>
        </Route>
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
