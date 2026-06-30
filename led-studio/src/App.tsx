import { BrowserRouter, HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { GlobalProjectToolbar } from './components/GlobalProjectToolbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardPage } from './routes/DashboardPage'
import { DancersPage } from './routes/DancersPage'
import { DeviceManagerPage } from './routes/DeviceManagerPage'
import { LedChainPage } from './routes/LedChainPage'
import { TimelinePage } from './routes/TimelinePage'
import { ShowControlPage } from './routes/ShowControlPage'
import { CalibrationPage } from './routes/CalibrationPage'
import './App.css'

/** file:// 打包版 Electron 必須用 HashRouter，否則 pathname 對不上 Routes */
function AppRouter({ children }: { children: React.ReactNode }) {
  const useHash = typeof window !== 'undefined' && window.location.protocol === 'file:'
  return useHash ? <HashRouter>{children}</HashRouter> : <BrowserRouter>{children}</BrowserRouter>
}

function AppShell() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">LED Show Studio</div>
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/dancers">舞者 CRUD</NavLink>
        <NavLink to="/timeline">Timeline</NavLink>
        <NavLink to="/led-chain">LED 串聯</NavLink>
        <NavLink to="/devices">Devices</NavLink>
        <NavLink to="/show">Show Control</NavLink>
        <NavLink to="/calibration">測試 / 校正</NavLink>
      </nav>
      <div className="main-column">
        <GlobalProjectToolbar />
        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dancers" element={<DancersPage />} />
            <Route path="/timeline" element={<ErrorBoundary title="Timeline 錯誤"><TimelinePage /></ErrorBoundary>} />
            <Route path="/led-chain" element={<LedChainPage />} />
            <Route path="/devices" element={<DeviceManagerPage />} />
            <Route path="/show" element={<ShowControlPage />} />
            <Route path="/calibration" element={<CalibrationPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppRouter>
      <AppShell />
    </AppRouter>
  )
}
