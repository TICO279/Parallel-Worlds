import React from 'react';
import { createRoot } from 'react-dom/client';
import { briefFromSearch } from '../shared/partner';
import { App } from './App';
import { Monitor } from './Monitor';
import { PhoneDate } from './PhoneDate';
import './index.css';
import './phone.css';
// Ember opens a date with the profile in the query string. Otherwise this is the monitor of the phone;
// ?lab keeps the original talk-to-Alex lab for development, tests and evaluation tools.
const partner = briefFromSearch(window.location.search);
const lab = new URLSearchParams(window.location.search).has('lab');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{partner ? <PhoneDate brief={partner} /> : lab ? <App /> : <Monitor />}</React.StrictMode>);
