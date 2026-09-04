import { useEffect } from 'react';
import Head from 'next/head';
import { Inter } from 'next/font/google';
import '../styles/globals.css';
import '../styles/tokens.css';
import { ToastProvider } from '../lib/toast';
import { ThemeProvider } from '../lib/theme';
import { installChunkErrorRecovery } from '../lib/chunkErrorRecovery';

const inter = Inter({ subsets: ['latin'], variable: '--ds-font-inter', display: 'swap' });

export default function App({ Component, pageProps }) {
  useEffect(() => installChunkErrorRecovery(), []);

  return (
    <>
      <Head>
        <title>IssueTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ThemeProvider>
        <ToastProvider>
          <div className={inter.variable}>
            <Component {...pageProps} />
          </div>
        </ToastProvider>
      </ThemeProvider>
    </>
  );
}
