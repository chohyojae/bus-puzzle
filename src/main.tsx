import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const classic = new URLSearchParams(location.search).get('classic') === '1';
if (!classic) document.documentElement.classList.add('coastal-depot');
const App = classic ? lazy(() => import('./app/App')) : lazy(() => import('./game/depot/DepotGame'));

const root = document.getElementById('root');
if (!root) throw new Error('앱을 표시할 요소가 없습니다.');
createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);
