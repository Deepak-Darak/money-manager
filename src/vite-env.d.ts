/// <reference types="vite/client" />

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
