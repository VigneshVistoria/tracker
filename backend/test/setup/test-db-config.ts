// The only database the tests may ever use: the throwaway one from
// scripts/test-db.sh. assertTestDatabase() is called before every
// connection the tests make.
export const TEST_DB = {
  host: '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || 55432),
  username: 'tracker_test',
  password: 'tracker_test',
  database: 'tracker_test',
};

export function assertTestDatabase(options: { host?: string; port?: number | string; database?: string }) {
  const okHost = options.host === '127.0.0.1' || options.host === 'localhost';
  if (!okHost || Number(options.port) !== TEST_DB.port || options.database !== TEST_DB.database) {
    throw new Error(
      `Refusing to run tests against ${options.host}:${options.port}/${options.database} - ` +
        `tests may only use the local throwaway database ${TEST_DB.host}:${TEST_DB.port}/${TEST_DB.database}.`,
    );
  }
}
