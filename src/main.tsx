import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return <main className="shell"><p className="eyebrow">BLIMCLIENT V2</p><h1>A cleaner way to play.</h1><p className="lede">The new foundation is ready. Your launcher experience starts here.</p><button>Coming soon</button></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
