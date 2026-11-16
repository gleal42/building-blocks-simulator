// Packs of designs that ship with the app. They show up in the Packs tab (read-only; make
// a copy to change one) and can be added to a challenge book in one go.
//
// To add a pack: in the Packs tab, press "Copy as code" and paste the result into this list
// (or hand it to whoever maintains the app). Each design is one picture:
//   looks  one digit per square, rows separated by "/":
//          1 white, 2 black,
//          3 split "/" white top-left, 4 split "/" black top-left,
//          5 split "\" white top-right, 6 split "\" black top-right
//   stars  1 easy, 2 medium, 3 hard
// Sizes are the book sizes: 2×2, 4×4, 6×6, 8×8 and 2×4, 4×8, 6×12 (rows × columns).
// Every design must be buildable with the pieces of its tray; the tests check this.

export const BUILT_IN_PACKS = [
  {
    id: 'starter-4x4',
    name: 'Starter 4×4',
    rows: 4,
    cols: 4,
    designs: [
      { looks: '1121/1122/1122/1122', stars: 1 },
      { looks: '5111/2121/2223/1122', stars: 1 },
      { looks: '2411/2221/5122/1124', stars: 2 },
      { looks: '2212/2432/2416/1111', stars: 2 },
      { looks: '6512/1322/1132/2141', stars: 3 },
      { looks: '6113/1322/2266/2411', stars: 3 },
    ],
  },
];
