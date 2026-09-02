import * as os from 'node:os';
import * as path from 'node:path';

export const APP_IDENTIFIER = 'com.github.studio-200a.vditor-electron';
export const APP_DIRECTORY_NAME = 'vditor-desktop';

export interface ApplicationPaths {
  configDir: string;
  recoveryDir: string;
  chromiumDir: string;
}

function absoluteEnvironmentPath(
  value: string | undefined,
  fallback: string,
  pathApi: typeof path.posix,
): string {
  return value && pathApi.isAbsolute(value) ? value : fallback;
}

export function resolveApplicationPaths(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): ApplicationPaths {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let configDir: string;
  let chromiumDir: string;

  if (platform === 'win32') {
    const roaming = absoluteEnvironmentPath(
      environment.APPDATA,
      pathApi.join(homeDirectory, 'AppData', 'Roaming'),
      pathApi,
    );
    const local = absoluteEnvironmentPath(
      environment.LOCALAPPDATA,
      pathApi.join(homeDirectory, 'AppData', 'Local'),
      pathApi,
    );
    configDir = pathApi.join(roaming, APP_DIRECTORY_NAME);
    chromiumDir = pathApi.join(local, APP_DIRECTORY_NAME, 'chromium');
  } else if (platform === 'darwin') {
    const applicationRoot = pathApi.join(
      homeDirectory,
      'Library',
      'Application Support',
      APP_IDENTIFIER,
    );
    configDir = pathApi.join(applicationRoot, 'Config');
    chromiumDir = pathApi.join(applicationRoot, 'Chromium');
  } else {
    const configHome = absoluteEnvironmentPath(
      environment.XDG_CONFIG_HOME,
      pathApi.join(homeDirectory, '.config'),
      pathApi,
    );
    const dataHome = absoluteEnvironmentPath(
      environment.XDG_DATA_HOME,
      pathApi.join(homeDirectory, '.local', 'share'),
      pathApi,
    );
    configDir = pathApi.join(configHome, APP_DIRECTORY_NAME);
    chromiumDir = pathApi.join(dataHome, APP_DIRECTORY_NAME, 'chromium');
  }

  configDir = absoluteEnvironmentPath(environment.VDITOR_DESKTOP_CONFIG_DIR, configDir, pathApi);
  chromiumDir = absoluteEnvironmentPath(environment.VDITOR_DESKTOP_DATA_DIR, chromiumDir, pathApi);

  return {
    configDir,
    recoveryDir: pathApi.join(pathApi.dirname(chromiumDir), 'recovery'),
    chromiumDir,
  };
}
