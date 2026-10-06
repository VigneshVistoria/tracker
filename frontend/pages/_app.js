import { useEffect } from 'react';
import Head from 'next/head';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import '../styles/globals.css';
import '../styles/tokens.css';
import { ToastProvider } from '../lib/toast';
import { ConfirmProvider } from '../lib/confirm';
import { ThemeProvider } from '../lib/theme';
import { installChunkErrorRecovery } from '../lib/chunkErrorRecovery';

const inter = Inter({ subsets: ['latin'], variable: '--ds-font-inter', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--ds-font-jakarta', display: 'swap' });
const fontVariables = `${inter.variable} ${jakarta.variable}`;

export default function App({ Component, pageProps }) {
  useEffect(() => installChunkErrorRecovery(), []);
  // Dialogs, toasts and the command palette portal into <body>, outside
  // the wrapper div below - put the font variable on <body> too so they
  // get the app fonts instead of the system fallback.
  useEffect(() => {
    document.body.classList.add(...fontVariables.split(' '));
  }, []);

  return (
    <>
      <Head>
        <title>IssueTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <div className={fontVariables}>
              <Component {...pageProps} />
            </div>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </>
  );
}
