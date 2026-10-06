import { useEffect } from 'react';
import Head from 'next/head';
import localFont from 'next/font/local';
import '../styles/globals.css';
import '../styles/tokens.css';
import { ToastProvider } from '../lib/toast';
import { ConfirmProvider } from '../lib/confirm';
import { ThemeProvider } from '../lib/theme';
import { installChunkErrorRecovery } from '../lib/chunkErrorRecovery';

// Self-hosted (frontend/fonts/, SIL OFL 1.1 - licences alongside) rather
// than next/font/google, which downloads the fonts during every build:
// a Google Fonts hiccup was failing builds/deploys (2026-10-06). Same
// latin-subset variable files Google serves, same CSS variable names.
const inter = localFont({
  src: '../fonts/Inter-Variable-latin.woff2',
  weight: '100 900',
  variable: '--ds-font-inter',
  display: 'swap',
});
const jakarta = localFont({
  src: '../fonts/PlusJakartaSans-Variable-latin.woff2',
  weight: '200 800',
  variable: '--ds-font-jakarta',
  display: 'swap',
});
// `font-root` (globals.css) re-declares the font tokens on the same
// element that carries these variables - declared on :root they'd resolve
// before the variables exist and silently fall back to plain names.
const fontVariables = `${inter.variable} ${jakarta.variable} font-root`;

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
