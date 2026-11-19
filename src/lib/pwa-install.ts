/**
 * Inline <head> script: Chrome may fire `beforeinstallprompt` before React has
 * loaded, so catch it straight away and keep it for the banner.
 */
export const INSTALL_PROMPT_CAPTURE = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__ftInstallPrompt=e;window.dispatchEvent(new Event("ft-install-ready"))});window.addEventListener("appinstalled",function(){window.__ftInstallPrompt=null});`;
