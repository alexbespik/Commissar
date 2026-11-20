// Original pixel art for the officer (no franchise artwork): the marching side view used by the burn effect, and a
// front-facing bust for the screamers. Rows are strings; each letter is a palette colour, '.' is clear.
export const COLORS = { K: [12, 11, 12], R: [128, 14, 14], r: [255, 40, 30], D: [28, 28, 32], C: [52, 55, 60], S: [196, 176, 156], s: [120, 100, 86], W: [232, 220, 205], G: [168, 134, 42], M: [124, 127, 134], m: [74, 76, 82], F: [255, 154, 26] };

export const MARCH = { rows: ['.......KKKKKKKKK........', '.....KKKKKKKKKKKKK......', '....KKKKKKKGGKKKKKK.....', '....KRRRRRRRRRRRRRK.....', '...KKKKKKKKKKKKKKKKK....', '..KKKKKKKKKKKKKKKKKKK...', '......sKKKKKKKKKs.......', '......srrsSSSsrrs.......', '......SSSSSWSSSSS.......', '......sSSSSWSSSSs.......', '.......sSKKKKKSs........', '........sSSSSSs.........', '.....DDDDKRRKDDDD.......', '...DDDDDDDKKDDDDDDD.....', '..DDDCDDDDDDDDDDCDDD....', '..DDCCDGDDDDDDGDCCDD....', '.DDDCCRRRRRRRRRRCCDDmmmm', '.DDDCCDDDDDDDDDDCMMMMMMF', '.DDDCCDGDDDDDDGDKMm.....', '.DDDCCDDDDDDDDDDKK......', '.DDDDCDDDDDDDDDCDD......', '.DDDDDDGDDDDDDGDDD......', '.DDDDDDDDDDDDDDDDDD.....', 'DDDDDDDDDDDDDDDDDDDD....', 'DDDDDDDDD..DDDDDDDDD....', 'DDDDDDDD....DDDDDDDD....', '.DDDDDD......DDDDDD.....', '...KKK.......KKK........', '..KKKK.......KKKK.......', '.KKKKK.......KKKKK......'], legs: ['....KKK....KKK..........', '...KKKK......KKKK.......', '..KKKKK.......KKKKK.....'] };

export const BUST = [
 "..........KKKKKKKKKKKK..........",
 "........KKKKKKKKKKKKKKKK........",
 "......KKKKKKKKKKKKKKKKKKKK......",
 ".....KKKKKKKKKKGGKKKKKKKKKK.....",
 ".....KKKKKKKKKGGGGKKKKKKKKK.....",
 ".....KRRRRRRRRRRRRRRRRRRRRK.....",
 "....KKKKKKKKKKKKKKKKKKKKKKKK....",
 "..KKKKKKKKKKKKKKKKKKKKKKKKKKKK..",
 ".........ssKKKKKKKKKKKss........",
 ".........sssssssssssssss........",
 ".........ssrrrsssssrrrss........",
 ".........sSrrrSSSSSrrrSs........",
 ".........SSSSSSWSSSSSSSS........",
 ".........SSSSSSSWSSSSSSS........",
 ".........sSSSSSSSWSSSSSs........",
 "..........SSSSKKKKKSSSS.........",
 "..........sSSSSSSSSSSSs.........",
 "...........sSSSSSSSSSs..........",
 "........DDDDDKRRRRKDDDDD........",
 "......DDDDDDDDKRRKDDDDDDDD......",
 "....DDDDDCDDDDDKKDDDDDCDDDDD....",
 "...DDDDDCCDDDDDDDDDDDDCCDDDDD...",
 "..DDDDDCCDDGDDDDDDDDGDDCCDDDDD..",
 "..DDDDDCRRRRRRRRRRRRRRRRCDDDDD..",
 "..DDDDDCCDDDDDDDDDDDDDDCCDDDDD..",
 "..DDDDDCCDDGDDDDDDDDGDDCCDDDDD..",
 "..DDDDDCCDDDDDDDDDDDDDDCCDDDDD..",
 "..DDDDDCCDDDDDDDDDDDDDDCCDDDDD..",
 "..DDDDDCCDDGDDDDDDDDGDDCCDDDDD..",
 "..DDDDDDDDDDDDDDDDDDDDDDDDDDDDD."
];

// overlays drawn over the bust: an arm pointing at you (foreshortened fist, finger towards you) and a pistol aimed at you
export const POINT = {"col": 22, "rows": {"13": "..KKKK..", "14": ".KKKKKK.", "15": "KKKSSKKK", "16": "KKSSSSKK", "17": "KKKSSKKK", "18": ".KKKKKK.", "19": "..DDDD..", "20": "..DDDD..", "21": "..DDDD.."}};
export const AIM = {"col": 21, "rows": {"12": "..mmmmm..", "13": ".mMMMMMm.", "14": "mMMKKKMMm", "15": "mMKKKKKMm", "16": "mMKKKKKMm", "17": "mMMKKKMMm", "18": ".mMMMMMm.", "19": "..KKKKK..", "20": "..DDDDD..", "21": "..DDDDD.."}};
