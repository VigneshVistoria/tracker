import Head from 'next/head';
import '../styles/globals.css';
import { ToastProvider } from '../lib/toast';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>IssueTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ToastProvider>
        <Component {...pageProps} />
      </ToastProvider>
    </>
  );
}
