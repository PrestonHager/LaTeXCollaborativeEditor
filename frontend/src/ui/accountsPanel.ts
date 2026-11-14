import type { ProviderEntry, ProviderRegistry } from '../storage/providers/registry';
import type { CommandId } from './menuBar';
import { describeCapabilities, providerDescriptions, statusLabels } from '../storage/providers/providerLabels';
import { icon, renderStaticIcons, storageIcons } from './icons';
import { returnFocusOnClose } from './focusReturn';
import { wireHelpLinks } from './helpLinks';
import './accountsPanel.css';

// The panel's markup. index.html only has the empty <dialog>, so none of this is in the first load.
const MARKUP = `<div>
  <header>
    <h2 id="accounts-dialog-title">Accounts</h2>
    <p id="accounts-dialog-description">Where projects can be saved, and who's signed in. Sign-ins stay in this tab and are never shared with your room.</p>
  </header>
  <section class="accounts-dialog-body">
    <ul id="accounts-list" class="accounts-list" aria-label="Storage providers"></ul>
  </section>
  <footer>
    <button id="accounts-logout-all" type="button" class="btn" data-variant="outline">Log out of everything</button>
    <span class="dialog-help-links"><a class="btn" data-variant="link" data-size="sm" data-help="saving">About saving</a></span>
    <button id="accounts-done" type="button" class="btn">Close</button>
  </footer>
  <button id="accounts-close" type="button" class="btn" data-variant="ghost" data-size="icon-sm" aria-label="Close accounts"><i data-lucide="x"></i></button>
</div>`;

export type AccountsPanelOptions = {
  registry: ProviderRegistry;
  /**
   * Run a command and wait for it, the way the menus do (errors become a notice). Connect and Log out
   * run each provider's connectCommand and logOutCommand, so Log out moves saving to this browser first.
   */
  runCommand(commandId: CommandId): Promise<void> | void;
  /** Where the docs are, for the About saving link (ui/helpLinks.ts). */
  docsBase?: string;
};

// Basecoat badge variants for each status.
const STATUS_VARIANT = { connected: 'secondary', expired: 'destructive', signedOut: 'outline', notConfigured: 'outline' } as const;

/** What the row says under the provider's name. */
export function accountLine(entry: ProviderEntry): string {
  const account = entry.account();
  switch (entry.status()) {
    case 'connected':
      if (!entry.needsSignIn) return providerDescriptions[entry.id];
      return account ? `Signed in as ${account}` : 'Signed in';
    case 'expired':
      return `${account ? `${account}: the` : 'The'} sign-in ran out. Connect to sign in again; until then edits save in this browser.`;
    case 'signedOut':
      return providerDescriptions[entry.id];
    case 'notConfigured':
      return "This site isn't set up for it. Whoever runs the site adds its keys (see the deployment guide).";
  }
}

const isSignedIn = (entry: ProviderEntry) => entry.needsSignIn && (entry.status() === 'connected' || entry.status() === 'expired');

/**
 * The Accounts panel (#200). One row per storage provider in the registry, with its status, the
 * signed-in account, and Connect or Log out. Rows are redrawn on every open and after every action,
 * so they always match the providers. Tokens never reach this module, only status and account names.
 */
export function createAccountsPanel(dialog: HTMLDialogElement, options: AccountsPanelOptions) {
  dialog.innerHTML = MARKUP;
  renderStaticIcons(dialog);
  if (options.docsBase !== undefined) wireHelpLinks(dialog, options.docsBase);
  const list = dialog.querySelector<HTMLUListElement>('#accounts-list')!;
  const logOutAll = dialog.querySelector<HTMLButtonElement>('#accounts-logout-all')!;
  const focusReturn = returnFocusOnClose(dialog);
  // While an action runs, every button waits, so two sign-ins can't overlap.
  let busy = false;

  const close = () => dialog.close();
  dialog.querySelector('#accounts-done')!.addEventListener('click', close);
  dialog.querySelector('#accounts-close')!.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    render();
    try {
      await work();
    } finally {
      busy = false;
      render();
    }
  }

  /** Log out of every provider with an account here, one at a time. */
  async function logOutOfEverything() {
    for (const entry of options.registry.list().filter(isSignedIn)) {
      if (entry.logOutCommand) await options.runCommand(entry.logOutCommand);
    }
  }

  logOutAll.addEventListener('click', () => void run(logOutOfEverything));

  function button(label: string, variant: string, commandId: CommandId | undefined, describedBy: string) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn';
    el.dataset.variant = variant;
    el.dataset.size = 'sm';
    el.textContent = label;
    el.setAttribute('aria-describedby', describedBy);
    el.disabled = busy || !commandId;
    el.addEventListener('click', () => void run(async () => commandId && options.runCommand(commandId)));
    return el;
  }

  function row(entry: ProviderEntry) {
    const status = entry.status();
    const li = document.createElement('li');
    li.className = 'accounts-row';
    li.dataset.provider = entry.id;
    li.dataset.status = status;

    const figure = document.createElement('figure');
    figure.append(icon(storageIcons[entry.icon] ?? storageIcons['hard-drive'], 'size-5'));

    const body = document.createElement('div');
    body.className = 'accounts-row-body';
    const title = document.createElement('h3');
    title.id = `accounts-${entry.id}-name`;
    title.textContent = entry.name;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.variant = STATUS_VARIANT[status];
    badge.textContent = statusLabels[status];
    title.append(' ', badge);
    const account = document.createElement('p');
    account.className = 'accounts-row-account';
    account.textContent = accountLine(entry);
    const caps = document.createElement('p');
    caps.className = 'accounts-row-caps';
    caps.textContent = describeCapabilities(entry.capabilities);
    body.append(title, account, caps);

    const actions = document.createElement('div');
    actions.className = 'accounts-row-actions';
    if (entry.needsSignIn && status !== 'connected') {
      const connect = button('Connect', status === 'expired' ? 'default' : 'outline', entry.connectCommand, title.id);
      if (status === 'notConfigured') connect.disabled = true;
      actions.append(connect);
    }
    if (isSignedIn(entry)) actions.append(button('Log out', 'outline', entry.logOutCommand, title.id));

    li.append(figure, body);
    if (actions.childElementCount) li.append(actions);
    return li;
  }

  function render() {
    const entries = options.registry.list();
    list.replaceChildren(...entries.map(row));
    logOutAll.disabled = busy || !entries.some(isSignedIn);
  }

  return {
    open() {
      render();
      focusReturn.remember();
      if (!dialog.open) dialog.showModal();
    },
    /** Redraw, for when a sign-in changed somewhere else (like a token running out). */
    refresh() {
      if (dialog.open) render();
    },
    isOpen: () => dialog.open,
  };
}
