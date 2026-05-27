import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Targets from './pages/Targets'
import SkillMarket from './pages/SkillMarket'
import Settings from './pages/Settings'
import Ocr from './pages/Ocr'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/targets" element={<Targets />} />
        <Route path="/skills" element={<SkillMarket />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/ocr" element={<Ocr />} />
      </Route>
    </Routes>
  )
}
