import React from 'react';
import { createRoot } from 'react-dom/client';
import { briefFromSearch } from '../shared/partner';
import { App } from './App';
import { PhoneDate } from './PhoneDate';
import './index.css';
import './phone.css';
// Ember jumps here with the profile in the query string; without one this is the lab.
const partner = briefFromSearch(window.location.search);
createRoot(document.getElementById('root')!).render(<React.StrictMode>{partner ? <PhoneDate brief={partner} /> : <App />}</React.StrictMode>);
