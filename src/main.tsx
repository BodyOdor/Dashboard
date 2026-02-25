import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Finances from './pages/Finances.tsx'
import NavSidebar from './components/NavSidebar.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NavSidebar />
      <div className="ml-14">
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/finances" element={<Finances />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
