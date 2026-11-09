import { loadScript } from './scriptLoader';

type PickerKind = 'file' | 'folder';

type PickerSelection = {
  id: string;
  name: string;
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

/**
 * Show the Google Picker and resolve with the chosen file or folder, or null if canceled.
 * The appId (Cloud project number) is needed so the drive.file scope grants access to
 * files the user picks that this app didn't create.
 */
export async function openGooglePicker(config: {
  accessToken: string;
  apiKey: string;
  appId?: string;
  kind: PickerKind;
}): Promise<PickerSelection | null> {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const picker = window.google.picker;
    const view =
      config.kind === 'folder'
        ? new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true)
        : new picker.DocsView(picker.ViewId.DOCS);

    let builder = new picker.PickerBuilder()
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .addView(view);
    if (config.appId) builder = builder.setAppId(config.appId);

    const pickerInstance = builder
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED && data.docs?.length) {
          const doc = data.docs[0];
          resolve({ id: doc.id, name: doc.name });
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
