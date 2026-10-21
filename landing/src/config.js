/**
 * Where the Salesdam application lives.
 *
 * The marketing site links here for "Sign in" and "Register". Override at
 * build time with PUBLIC_APP_URL (e.g. the Render static site URL); the
 * default matches the production host in deploy/nginx-platform.salesdam.com.conf.
 */
export const APP_URL = (
  import.meta.env.PUBLIC_APP_URL || 'https://platform.salesdam.com'
).replace(/\/$/, '');
