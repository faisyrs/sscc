// Optional 3D-printed holder for the round tokens (make_tokens.py). The
// tokens are designed to be glued to card stock; this is an alternative.
// A disc with a pocket that fits a printed token. Its rim matches the
// measuring template: a 1 mm deep pocket with a 0.5 mm rounded inner edge,
// and a 0.4 mm rounded outer edge.
//
// Disc diameter = token diameter + 2 * inset:
//   40 mm token -> 44 mm disc (Riled Up, War Cry, Charged)
//   32 mm token -> 36 mm disc (most tokens)
//   25 mm token -> 29 mm disc (Not Dead Yet markers)
//
//   openscad -D token=40 -o token_disc_40.stl token_disc.scad
//
// For two-sided tokens on an FDM printer, print two discs and glue them back to
// back, flat faces together, as with the template. double_sided=true gives one
// disc with a pocket on both faces, for resin printers; it needs thickness=3.

token = 32;                // diameter of the printed token that goes in the pocket
thickness = 2.0;           // one layer; two glued back to back make a 4 mm token
inset = 2.0;               // rim width around the sticker
recess = 1.0;              // pocket depth
rim_r = 0.5;               // rounded inner (pocket) edge
edge_r = 0.4;              // rounded outer edge
double_sided = false;
$fn = 160;

P = token / 2;             // pocket radius
R = P + inset;
T = thickness;

function arc(cx, cy, r, a0, a1, n = 12) = [for (i = [0 : n]) let (a = a0 + (a1 - a0) * i / n) [cx + r * cos(a), cy + r * sin(a)]];

// Upper half of the cross-section, from the centre outwards along the pocket
// floor, up the pocket wall, over the rounded rim and down the outer edge.
function top_profile() = concat(
    [[0, T - recess], [P, T - recess]],
    arc(P + rim_r, T - rim_r, rim_r, 180, 90),       // pocket edge, convex
    arc(R - edge_r, T - edge_r, edge_r, 90, 0)       // outer edge
);

module disc() {
    assert(inset >= rim_r + edge_r, "inset must be at least rim_r + edge_r");
    assert(recess < (double_sided ? T / 2 : T), "pocket too deep for the thickness; with double_sided use thickness=3");
    top = top_profile();
    bottom = double_sided
        ? [for (i = [len(top) - 1 : -1 : 0]) [top[i][0], T - top[i][1]]]   // mirror of the top
        : [[R, 0], [0, 0]];
    rotate_extrude() polygon(concat(top, bottom));
}

disc();
