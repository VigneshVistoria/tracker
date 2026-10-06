import { Html, Head, Main, NextScript } from 'next/document';
import { THEME_INIT_SCRIPT } from '../lib/theme';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* No external font stylesheet: Inter and Plus Jakarta Sans are
            self-hosted via next/font/local in _app.js (2026-10-06). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
