import { loadScript } from './scriptLoader';

// 'project' shows folders and files, so you can open a project folder or an old single .tex file.
type PickerKind = 'project' | 'folder';

export type PickerSelection = {
  id: string;
  name: string;
  isFolder: boolean;
};

type PickerConfig = {
  accessToken: string;
  apiKey: string;
  appId?: string;
};

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

let pickerLoadPromise: Promise<void> | null = null;

async function ensurePickerLoaded() {
  if (!pickerLoadPromise) {
    pickerLoadPromise = (async () => {
      await Promise.all([
        loadScript('https://apis.google.com/js/api.js', 'the Google Picker'),
        loadScript('https://accounts.google.com/gsi/client', 'Google sign-in'),
      ]);
      if (!window.gapi?.load) throw new Error('Google Picker script loaded but gapi is missing');
      await new Promise<void>((resolve, reject) => {
        window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Could not load the Google Picker')) });
      });
    })().catch((error) => {
      // Let the next click try again instead of caching the failure forever.
      pickerLoadPromise = null;
      throw error;
    });
  }
  await pickerLoadPromise;
}

const toSelection = (doc: any): PickerSelection => ({
  id: doc.id,
  name: doc.name,
  isFolder: doc.mimeType === 'application/vnd.google-apps.folder',
});

/** Build and show a Picker with one view. Resolves with what was picked, or null if canceled. */
function showPicker(config: PickerConfig, view: any, multiselect: boolean): Promise<PickerSelection[] | null> {
  return new Promise((resolve) => {
    const picker = window.google.picker;
    let builder = new picker.PickerBuilder()
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .addView(view);
    if (config.appId) builder = builder.setAppId(config.appId);
    if (multiselect) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);

    const pickerInstance = builder
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED && data.docs?.length) {
          resolve(data.docs.map(toSelection));
          return;
        }
        if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();

    pickerInstance.setVisible(true);
  });
}

/**
 * Show the Google Picker and resolve with the chosen project folder, file, or folder, or null if canceled.
 * The appId (Cloud project number) is needed so the drive.file scope grants access to
 * files the user picks that this app didn't create.
 */
export async function openGooglePicker(config: PickerConfig & { kind: PickerKind }): Promise<PickerSelection | null> {
  await ensurePickerLoaded();
  const picker = window.google.picker;
  const view =
    config.kind === 'folder'
      ? new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true)
      : new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
  const picked = await showPicker(config, view, false);
  return picked?.[0] ?? null;
}

/**
 * Show the Picker inside a project folder with multi-select on, so one pick can grant access to
 * many files and subfolders that were added to the folder from Drive itself.
 * NOTE: with the drive.file scope, picking is the only way the app gets to see those files.
 */
export async function pickProjectFiles(config: PickerConfig & { folderId: string }): Promise<PickerSelection[] | null> {
  await ensurePickerLoaded();
  const picker = window.google.picker;
  const view = new picker.DocsView(picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setParent(config.folderId);
  return showPicker(config, view, true);
}
