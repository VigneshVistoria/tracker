import Head from 'next/head';
import { Inter } from 'next/font/google';
import '../styles/globals.css';
import '../styles/tokens.css';
import { ToastProvider } from '../lib/toast';

const inter = Inter({ subsets: ['latin'], variable: '--ds-font-inter', display: 'swap' });

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>IssueTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ToastProvider>
        <div className={inter.variable}>
          <Component {...pageProps} />
        </div>
      </ToastProvider>
    </>
  );
}
