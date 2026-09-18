import { createRoot } from 'react-dom/client';
import App from '../App';
import { PromptProvider } from '../PromptDialog';
import { DraftProvider } from '../DraftContext';
import '../styles.css';
createRoot(document.getElementById('root')!).render(
  <PromptProvider>
    <DraftProvider>
      <App />
    </DraftProvider>
  </PromptProvider>,
);
