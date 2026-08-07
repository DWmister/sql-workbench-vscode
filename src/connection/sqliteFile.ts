import * as fs from 'fs';

export async function readSqliteDatabaseFile(
  filePath: string | undefined,
): Promise<{ path: string; bytes: Buffer }> {
  if (!filePath) {
    throw new Error('SQLite connection is missing a database file path.');
  }

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      throw new Error(`SQLite database file does not exist: ${filePath}`);
    }

    throw new Error(
      `Unable to access SQLite database file ${filePath}: ${getErrorMessage(error)}`,
    );
  }

  if (!stats.isFile()) {
    throw new Error(`SQLite database path is not a file: ${filePath}`);
  }

  try {
    return {
      path: filePath,
      bytes: await fs.promises.readFile(filePath),
    };
  } catch (error) {
    throw new Error(
      `Unable to read SQLite database file ${filePath}: ${getErrorMessage(error)}`,
    );
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
