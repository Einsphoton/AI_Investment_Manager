import { Routes, Route, Navigate } from 'react-router-dom'
import { AIWorkProvider } from './stores/AIWorkContext'
import AppLayout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Targets from './pages/Targets'
import InvestmentAdvice from './pages/InvestmentAdvice'
import SkillMarket from './pages/SkillMarket'
import Settings from './pages/Settings'
import Ocr from './pages/Ocr'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <AIWorkProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/assets" element={<ErrorBoundary><Assets /></ErrorBoundary>} />
          <Route path="/targets" element={<ErrorBoundary><Targets /></ErrorBoundary>} />
          <Route path="/investment-advice" element={<ErrorBoundary><InvestmentAdvice /></ErrorBoundary>} />
          <Route path="/skills" element={<ErrorBoundary><SkillMarket /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
          <Route path="/ocr" element={<ErrorBoundary><Ocr /></ErrorBoundary>} />
        </Route>
      </Routes>
    </AIWorkProvider>
  )
}
