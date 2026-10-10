// Draws the Samsung TV app's icon from the brand, into tizen/icon.png: the lockup on the dark
// ground at 512×423, the size Samsung's TVs show in the apps row (config.xml's <icon>). The same
// lockup as the Android TV banner (android-art.mjs). Run again when the brand changes:
// npm run tizen:art -w @opencast/tv

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { artBrowser, lockupPage } from "./brand-art.mjs";

const { shot, close } = await artBrowser();
writeFileSync(fileURLToPath(new URL("../tizen/icon.png", import.meta.url)), await shot(lockupPage(512, 423, 0.78), 512, 423));
await close();
console.log("Samsung TV icon drawn.");
