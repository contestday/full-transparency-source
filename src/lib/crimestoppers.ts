/**
 * Crimestoppers: an independent charity that takes information about crime
 * anonymously and passes it to the police. They never ask for your name, so a
 * report going to them leaves out who made it.
 */
export const CRIMESTOPPERS = {
  name: "Crimestoppers",
  tel: "0800555111",
  telLabel: "0800 555 111",
  web: "https://crimestoppers-uk.org/",
} as const;

export type SendTo = "police" | "crimestoppers";
