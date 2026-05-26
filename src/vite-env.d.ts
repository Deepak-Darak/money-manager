/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_GOOGLE_CLIENT_ID?: string;
	readonly VITE_SYNC_ENDPOINT?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare global {
	interface Window {
		google?: {
			accounts?: {
				id?: {
					initialize: (options: {
						client_id: string;
						callback: (response: { credential?: string }) => void;
					}) => void;
					renderButton: (
						element: HTMLElement,
						options: { theme?: string; size?: string; shape?: string; text?: string }
					) => void;
				};
			};
		};
	}
}

export {};
