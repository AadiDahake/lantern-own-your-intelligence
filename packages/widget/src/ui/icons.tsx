import type { JSX } from 'preact';

const base: JSX.SVGAttributes<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.8,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
};

export const ChatIcon = () => (
  <svg {...base}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const SendIcon = () => (
  <svg {...base}>
    <path d="M4.5 12h13M12 5.5 18.5 12 12 18.5" />
  </svg>
);

export const MicIcon = () => (
  <svg {...base}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const MicOffIcon = () => (
  <svg {...base}>
    <path d="M15 5a3 3 0 0 0-6 0v4M9 12v2a3 3 0 0 0 4.6 2.5" />
    <path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    <path d="m4 3 16 18" />
  </svg>
);

export const SpeakerIcon = () => (
  <svg {...base}>
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
  </svg>
);

export const PhoneIcon = () => (
  <svg {...base}>
    <path d="M6.5 3.5h3l1.5 4-2 1.3a12 12 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
  </svg>
);

/** The handset struck through: at this size it reads as hanging up where a rotation does not. */
export const PhoneEndIcon = () => (
  <svg {...base}>
    <path d="M8.2 4.2h2.4l1.2 3.4-1.7 1.1a11 11 0 0 0 4.6 4.6l1.1-1.7 3.4 1.2v2.4a1.8 1.8 0 0 1-2 1.8A14.6 14.6 0 0 1 6.4 6.2a1.8 1.8 0 0 1 1.8-2Z" />
    <path d="m3.5 3.5 17 17" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...base}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const ThumbUpIcon = () => (
  <svg {...base}>
    <path d="M7 10.5 11 3a2.2 2.2 0 0 1 2.2 2.7L12.5 9h4.7A2 2 0 0 1 19 11.4l-1.3 6A2 2 0 0 1 15.7 19H7" />
    <rect x="3" y="10" width="4" height="9" rx="1.2" />
  </svg>
);

export const ThumbDownIcon = () => (
  <svg {...base}>
    <path d="M7 13.5 11 21a2.2 2.2 0 0 0 2.2-2.7L12.5 15h4.7A2 2 0 0 0 19 12.6l-1.3-6A2 2 0 0 0 15.7 5H7" />
    <rect x="3" y="5" width="4" height="9" rx="1.2" />
  </svg>
);
