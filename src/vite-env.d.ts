/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APP_PASSWORD?: string;
	readonly VITE_SYNC_ENDPOINT?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
