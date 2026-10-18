/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_LAUNCH_MODE?: string;
  readonly PUBLIC_WATCH_URL?: string;
  readonly PUBLIC_APP_URL?: string;
  readonly PUBLIC_BUSINESS_URL?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_CONTACT_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
