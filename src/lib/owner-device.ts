/**
 * "This is the owner's device": set on any device that has opened the admin
 * area (kept on the device). Its visits are still recorded like anyone's, just
 * tagged, so the Journeys report can hide them. Stored only on the device.
 */
const KEY = "ft-owner-device";

export function isOwnerDevice(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Opening the admin area marks the device, unless the owner chose to show it. */
export function markOwnerDevice() {
  try {
    if (localStorage.getItem(KEY) == null) localStorage.setItem(KEY, "1");
  } catch {
    // Private mode: nothing to do.
  }
}

export function setOwnerDevice(own: boolean) {
  try {
    localStorage.setItem(KEY, own ? "1" : "0");
  } catch {
    // ignore
  }
}
