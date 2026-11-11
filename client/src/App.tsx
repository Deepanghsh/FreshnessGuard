import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Inspector from './pages/Inspector';
import Playground from './pages/Playground';
import Architecture from './pages/Architecture';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="inspector/:id" element={<Inspector />} />
          <Route path="playground" element={<Playground />} />
          <Route path="architecture" element={<Architecture />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
