import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Buildings from './pages/Buildings.jsx';
import Transportation from './pages/Transportation.jsx';
import Flood from './pages/Flood.jsx';
import Methods from './pages/Methods.jsx';

const NAV = [
  ['/buildings', 'Buildings'],
  ['/transportation', 'Transportation'],
  ['/flood', 'Flood Exposure'],
  ['/methods', 'Methods'],
];
const TITLES = { '/': 'Home', '/buildings': 'Buildings', '/transportation': 'Transportation',
                 '/flood': 'Flood Exposure', '/methods': 'Methods' };

export default function App() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    document.title = `${TITLES[pathname] || 'Not found'} · St. Louis GIS Portfolio`;
  }, [pathname]);

  return (
    <div className="app">
      <header className="site-header">
        <NavLink to="/" className="brand">St. Louis GIS Portfolio</NavLink>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-nav"
                onClick={() => setOpen((o) => !o)}>Menu</button>
        <nav id="site-nav" className={open ? 'open' : ''}>
          {NAV.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buildings" element={<Buildings />} />
          <Route path="/transportation" element={<Transportation />} />
          <Route path="/flood" element={<Flood />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="*" element={<div className="prose"><h1>Page not found</h1><p><NavLink to="/">Back to the home page</NavLink></p></div>} />
        </Routes>
      </main>
    </div>
  );
}
