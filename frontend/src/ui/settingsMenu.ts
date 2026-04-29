type SettingsActions = {
  onToggleSaveNow: (enabled: boolean) => void;
  onClearSavedDocuments: () => Promise<void> | void;
};

export function createSettingsMenu(container: HTMLElement, actions: SettingsActions) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-menu';

  const title = document.createElement('span');
  title.textContent = 'Settings';
  title.className = 'settings-title';

  const disableLabel = document.createElement('label');
  disableLabel.className = 'settings-option';
  const disableToggle = document.createElement('input');
  disableToggle.type = 'checkbox';
  disableToggle.onchange = () => actions.onToggleSaveNow(!disableToggle.checked);
  disableLabel.append(disableToggle, document.createTextNode(' Disable Save Now'));

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear Local Docs';
  clearBtn.onclick = () => void actions.onClearSavedDocuments();

  wrapper.append(title, disableLabel, clearBtn);
  container.appendChild(wrapper);
}
