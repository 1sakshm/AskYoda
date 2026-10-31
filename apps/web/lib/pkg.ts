/**
 * The askyoda npm package. Set NEXT_PUBLIC_NPM_PUBLISHED=true on the web deploy once
 * `npm publish` has run: until then the site says "publishing soon" and links to the source.
 */
export const PKG = {
  name: "askyoda",
  version: "0.1.0",
  published: process.env.NEXT_PUBLIC_NPM_PUBLISHED === "true",
  npmUrl: "https://www.npmjs.com/package/askyoda",
  sourceUrl: "https://github.com/1sakshm/AskYoda/tree/main/packages/askyoda",
  install: "npm i askyoda",
} as const;

export const PKG_BADGES = ["Zero dependencies", "TypeScript", "Bring your own TinyFish key", "MIT"];
