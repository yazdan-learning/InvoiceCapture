import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { LanguageProvider } from './i18n/LanguageContext';
import { CountryProvider } from './country/CountryContext';
import { ModulesProvider } from './workspace/ModulesContext';
import './App.css';

const root = document.getElementById('root');

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <LanguageProvider>
            <CountryProvider>
              <ModulesProvider>
                <App />
              </ModulesProvider>
            </CountryProvider>
          </LanguageProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}


