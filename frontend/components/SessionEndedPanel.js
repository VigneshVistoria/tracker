import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import Button from './ui/Button';
import { subscribeSession, continueToSignIn } from '../lib/session';
import styles from './SessionEndedPanel.module.css';

// Shown over a page whose session ended while nobody was using it (a wall
// display, a tab left open). Calm, not an error: one button to sign in
// again, which returns to this exact page. Someone actively using the
// page is sent to sign-in directly instead (lib/session.js).
export default function SessionEndedPanel() {
  const [state, setState] = useState(null);
  useEffect(() => subscribeSession(setState), []);

  if (!state?.prompt) return null;
  return (
    <div className={styles.backdrop}>
      {/* The only control is Continue - keep keyboard focus on it. */}
      <div
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-ended-title"
        aria-describedby="session-ended-text"
        onKeyDown={(e) => e.key === 'Tab' && e.preventDefault()}
      >
        <h2 id="session-ended-title" className={styles.title}>
          Session ended
        </h2>
        <p id="session-ended-text" className={styles.text}>
          For your security you were signed out after a while. Click to continue - you will come back to this page after signing in.
        </p>
        <Button leftIcon={LogIn} onClick={continueToSignIn} autoFocus fullWidth>
          Continue
        </Button>
      </div>
    </div>
  );
}
