import { render } from 'preact';
import { App, type LanternApi } from './ui/App';
import { ApiClient } from './api/client';
import { attachStyles, detectScheme } from './styles';

declare global {
  interface Window {
    Lantern?: LanternApi;
  }
}

type Config = { key: string; apiBase: string; position: 'left' | 'right' };

const HOST_TAG = 'lantern-widget';

/** The console links here with a question so a support lead can replay it on the real site. */
const ASK_PARAM = 'lantern_ask';

function pendingQuestion(): string {
  return new URLSearchParams(location.search).get(ASK_PARAM)?.trim() ?? '';
}

function readConfig(): Config | null {
  const script = document.currentScript as HTMLScriptElement | null;
  const element = script ?? document.querySelector<HTMLScriptElement>('script[data-key]');
  const key = element?.dataset.key?.trim();
  if (!key) {
    console.warn('[lantern] no data-key on the script tag, the widget will not load');
    return null;
  }
  const origin = element?.src ? new URL(element.src, location.href).origin : location.origin;
  const apiBase = element?.dataset.api?.trim() || origin;
  const position = element?.dataset.position === 'left' ? 'left' : 'right';
  return { key, apiBase, position };
}

function mount(config: Config): void {
  if (document.querySelector(HOST_TAG)) return;

  // `register` runs on every render, so the replayed question is asked once and then cleared.
  let pending = pendingQuestion();

  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-pl-scheme', detectScheme());
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  attachStyles(shadow);

  const container = document.createElement('div');
  shadow.appendChild(container);

  // The host page can change its own theme at any time; follow it.
  const observer = new MutationObserver(() => host.setAttribute('data-pl-scheme', detectScheme()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

  const client = new ApiClient({ apiBase: config.apiBase, key: config.key });

  render(
    <App
      client={client}
      shadow={shadow}
      host={host}
      position={config.position}
      register={(api) => {
        window.Lantern = api;
        if (pending) {
          const question = pending;
          pending = '';
          // The host page may still be settling, and the scan must see its real controls.
          setTimeout(() => window.Lantern?.ask(question), 400);
        }
      }}
    />,
    container,
  );
}

function boot(): void {
  const config = readConfig();
  if (!config) return;
  if (document.body) mount(config);
  else document.addEventListener('DOMContentLoaded', () => mount(config), { once: true });
}

boot();
