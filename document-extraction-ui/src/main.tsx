import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp } from 'antd';
import { ProductThemeProvider } from './theme.tsx';
import App from './App.tsx';
import { HelpCenter } from './help/HelpCenter.tsx';
import { DEMO_MODE } from './demoMode.ts';
import 'antd/dist/reset.css';
import './styles.css';
import './components/profiles.css';
import './components/service-workbench.css';
import './components/studio.css';
import './help/help.css';

if (DEMO_MODE) {
  (await import('./demo/api.ts')).installDemoApi();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ProductThemeProvider><AntApp>{new URLSearchParams(location.search).get('page') === 'help' ? <HelpCenter /> : <App />}</AntApp></ProductThemeProvider></React.StrictMode>,
);
