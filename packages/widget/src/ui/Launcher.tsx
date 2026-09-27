import { ChatIcon, CloseIcon } from './icons';

export function Launcher({
  open,
  unread,
  onClick,
}: {
  open: boolean;
  /** An answer arrived while the panel was closed. */
  unread: boolean;
  onClick: () => void;
}) {
  const label = open ? 'Close support' : unread ? 'Open support, one new answer' : 'Open support';
  return (
    <button
      type="button"
      class="pl-launcher"
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
    >
      {open ? <CloseIcon /> : <ChatIcon />}
      {!open && unread && <span class="pl-launcher__dot" aria-hidden="true" />}
    </button>
  );
}
