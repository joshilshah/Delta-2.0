import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/Layout.jsx';
import { FullPageSpinner } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';

// Each page loads on demand, so the first screen arrives faster.
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Signup = lazy(() => import('./pages/Signup.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const PassengerBook = lazy(() => import('./pages/passenger/Book.jsx'));
const PassengerRide = lazy(() => import('./pages/passenger/Ride.jsx'));
const PassengerActivity = lazy(() => import('./pages/passenger/Activity.jsx'));
const DriverDashboard = lazy(() => import('./pages/driver/Dashboard.jsx'));
const DriverRequests = lazy(() => import('./pages/driver/Requests.jsx'));
const DriverRide = lazy(() => import('./pages/driver/Ride.jsx'));
const DriverEarnings = lazy(() => import('./pages/driver/Earnings.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const TripDetail = lazy(() => import('./pages/TripDetail.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const SharedTrip = lazy(() => import('./pages/SharedTrip.jsx'));
const Story = lazy(() => import('./pages/Story.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

function PublicOnly({ children }) {
  const { me } = useAuth();
  if (!me) return children;
  return <Navigate to={me.profile.needs_onboarding ? '/onboarding' : `/${me.user.role}/dashboard`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/share/:token" element={<SharedTrip />} />
        <Route path="/story" element={<Story />} />
        {/* Admin dashboard: any signed-in account listed in app_admins (the page and the API both check). */}
        <Route path="/admin" element={<Admin />} />

        <Route element={<ProtectedRoute role="passenger" />}>
          {/* Home and Book were the same job: one Ride screen serves both routes. */}
          <Route path="/passenger/dashboard" element={<PassengerBook />} />
          <Route path="/passenger/book" element={<PassengerBook />} />
          <Route path="/passenger/ride/:id" element={<PassengerRide />} />
          <Route path="/passenger/activity" element={<PassengerActivity />} />
          <Route path="/passenger/account" element={<Account />} />
          <Route path="/passenger/trips/:id" element={<TripDetail />} />
          <Route path="/passenger/support" element={<Support />} />
        </Route>

        <Route element={<ProtectedRoute role="driver" />}>
          <Route path="/driver/dashboard" element={<DriverDashboard />} />
          <Route path="/driver/requests" element={<DriverRequests />} />
          <Route path="/driver/ride/:id" element={<DriverRide />} />
          <Route path="/driver/earnings" element={<DriverEarnings />} />
          <Route path="/driver/account" element={<Account />} />
          <Route path="/driver/trips/:id" element={<TripDetail />} />
          <Route path="/driver/support" element={<Support />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
