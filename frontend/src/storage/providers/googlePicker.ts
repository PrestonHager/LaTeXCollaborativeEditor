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

let pickerScriptPromise: Promise<void> | null = null;
let gapiScriptPromise: Promise<void> | null = null;

const ensureScript = (src: string): Promise<void> => {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
};

async function ensurePickerLoaded() {
  if (!pickerScriptPromise) {
    pickerScriptPromise = ensureScript('https://apis.google.com/js/api.js');
  }
  if (!gapiScriptPromise) {
    gapiScriptPromise = ensureScript('https://accounts.google.com/gsi/client');
  }
  await Promise.all([pickerScriptPromise, gapiScriptPromise]);
  await new Promise<void>((resolve) => window.gapi.load('picker', () => resolve()));
}

export async function openGooglePicker(config: {
  accessToken: string;
  apiKey: string;
  kind: PickerKind;
}): Promise<PickerSelection | null> {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const picker = window.google.picker;
    const view =
      config.kind === 'folder'
        ? new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true)
        : new picker.DocsView(picker.ViewId.DOCS);

    const pickerInstance = new picker.PickerBuilder()
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .addView(view)
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
