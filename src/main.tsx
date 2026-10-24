import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Phase3Harness } from './Phase3Harness';
import './index.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname==='/phase3'?<Phase3Harness/>:<App/>}</React.StrictMode>);
