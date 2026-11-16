// Packs that ship with the app: the files in packs/ (one pack per .json file), read when the
// app is built (see scripts/build.mjs). They show in the Packs tab, read-only (make a copy to
// change one). Each file is a pack as the app saves it:
//   { "format": "building-blocks-pack", "version": 1, "id", "name", "rows", "cols",
//     "designs": [{ "looks": "1121/1122/1122/1122", "stars": 1 }, ...] }
// Every design must be buildable with the pieces of its tray; the tests check this.

/* global __BUILT_IN_PACKS__ */
export const BUILT_IN_PACKS = typeof __BUILT_IN_PACKS__ !== 'undefined' ? __BUILT_IN_PACKS__ : [];
