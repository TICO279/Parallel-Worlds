import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Phase3Harness } from './Phase3Harness';
import { MobileApp } from './mobile/MobileApp';
import './index.css';
const page=location.pathname==='/phase3'?<Phase3Harness/>:location.pathname==='/lab'||new URLSearchParams(location.search).has('lab')?<App/>:<MobileApp/>;
createRoot(document.getElementById('root')!).render(<React.StrictMode>{page}</React.StrictMode>);
