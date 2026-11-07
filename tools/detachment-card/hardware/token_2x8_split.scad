// Measuring token, split in two pieces for printers with a small bed.
// Same token as token_2x8.scad (2 x 8 in, 3 mm thick, 2 mm sticker inset,
// 1 mm pocket with a rounded rim, rounded outer top edge, 1 mm deep notches
// at each inch), split at an inch station (5 in by default)
// and joined with dovetails. Piece A is 50.8 x 132 mm including the
// dovetails; piece B is 50.8 x 76.2 mm. Both fit side by side on a 142 mm
// (5.6 in) bed: part = "plate".
//
// Two-layer token: print two of these, one for each card side, and glue them
// back to back with one layer turned end over end. The seams then sit at
// 5 in on one layer and 3 in on the other, so each seam is backed by a solid
// part of the other layer. part = "laminated" shows the result.
//
// Export one STL per part:
//   openscad -D 'part="a"'     -o token_half_a.stl token_2x8_split.scad
//   openscad -D 'part="b"'     -o token_half_b.stl token_2x8_split.scad
//   openscad -D 'part="plate"' -o token_plate.stl  token_2x8_split.scad
// part = "assembled" and part = "laminated" are for checking only.
//
// Print flat, pocket side up. Push the halves together and glue the joint;
// the sticker then covers the seam.

part = "plate";            // "a", "b", "plate", "assembled" or "laminated"
split_in = 5;              // the inch station to split at (1-7); 5 gives a 5 in and a 3 in piece
double_sided = false;      // true adds a sticker pocket on the bottom face too
clearance = 0.15;          // gap around each dovetail; raise it if the joint is too tight

W = 50.8; L = 203.2; T = 3.0;
inset = 2.0;               // border around the sticker; the pocket is 46.8 x 199.2 mm
recess = 1.0;              // pocket depth
rim_r = 0.5;               // radius of the rounded pocket rim (0 for a square edge)
rim_steps = 8;             // facets in the rounded rim
edge_r = 0.4;              // radius of the rounded outer top edge (0 for a square edge). Above 0.4
                           // the outer and inner roundings meet in a sharp crest at each notch tip.
edge_steps = 10;           // slices in the rounded outer edge
notch_base = 1.6; notch_depth = 1.0; overcut = 0.5;
split = split_in * 25.4;

// Dovetails: narrow at the seam, wide at the tip, so the halves can't pull apart.
tail_neck = 7; tail_tip = 10; tail_depth = 5;
tail_x = [W * 0.27, W * 0.73];   // centres, clear of the edge notches

// The token's outline seen from above: the rectangle with the notches cut out.
module outline2d() {
    difference() {
        square([W, L]);
        for (i = [1:7]) {
            y = i * 25.4;
            polygon([[-overcut, y - notch_base / 2], [-overcut, y + notch_base / 2], [notch_depth, y]]);
            polygon([[W + overcut, y - notch_base / 2], [W + overcut, y + notch_base / 2], [W - notch_depth, y]]);
        }
    }
}

// The top edge_r mm of the body: thin slices of the outline, each shrunk inward
// along a quarter circle, so the outer edge (sides, corners and notches) is rounded.
module rounded_band() {
    for (i = [0 : edge_steps - 1]) {
        z0 = T - edge_r + edge_r * i / edge_steps;
        z1 = T - edge_r + edge_r * (i + 1) / edge_steps;
        g = edge_r - sqrt(edge_r * edge_r - pow(z1 - T + edge_r, 2));
        translate([0, 0, z0]) linear_extrude(height = z1 - z0 + 0.001) offset(r = -g) outline2d();
    }
}

// The solid token before the pocket is cut. The bottom edge is rounded only when
// double_sided, because a single-sided token prints on that face and gets glued there.
module body() {
    lo = double_sided ? edge_r : 0;
    translate([0, 0, lo]) linear_extrude(height = T - edge_r - lo + 0.001) outline2d();
    if (edge_r > 0) {
        rounded_band();
        if (double_sided) translate([0, 0, T]) mirror([0, 0, 1]) rounded_band();
    }
}

// The sticker pocket, cut down from the top face (z = T). The floor is exactly
// the sticker's size, with square corners for its square-cut corners. Over the
// top rim_r mm the opening widens along a quarter circle, so the rim is rounded.
module pocket() {
    pw = W - 2 * inset; pl = L - 2 * inset;
    translate([inset, inset, T - recess]) cube([pw, pl, recess + overcut]);
    if (rim_r > 0)
        for (i = [0 : rim_steps - 1]) {
            z0 = T - rim_r + rim_r * i / rim_steps;
            z1 = T - rim_r + rim_r * (i + 1) / rim_steps;
            g0 = rim_r - sqrt(rim_r * rim_r - pow(z0 - T + rim_r, 2));
            g1 = rim_r - sqrt(rim_r * rim_r - pow(z1 - T + rim_r, 2));
            hull() {
                translate([inset - g0, inset - g0, z0]) cube([pw + 2 * g0, pl + 2 * g0, 0.001]);
                translate([inset - g1, inset - g1, z1]) cube([pw + 2 * g1, pl + 2 * g1, 0.001]);
            }
            if (i == rim_steps - 1)
                translate([inset - g1, inset - g1, z1 - 0.001]) cube([pw + 2 * g1, pl + 2 * g1, overcut]);
        }
}

module token() {
    difference() {
        body();
        pocket();
        if (double_sided)  // the same pocket, mirrored onto the bottom face
            translate([0, 0, T]) mirror([0, 0, 1]) pocket();
    }
}

// The dovetails stick out of half A into half B. grow widens them (for B's sockets).
module tails(grow = 0) {
    for (x = tail_x)
        translate([0, 0, -overcut])
            linear_extrude(height = T + 2 * overcut)
                offset(delta = grow)
                    polygon([[x - tail_neck / 2, split - 0.01], [x + tail_neck / 2, split - 0.01],
                             [x + tail_tip / 2, split + tail_depth], [x - tail_tip / 2, split + tail_depth]]);
}

module half_a() {
    intersection() {
        token();
        union() {
            translate([-1, -1, -1]) cube([W + 2, split + 1, T + 2]);
            tails();
        }
    }
}

module half_b() {
    difference() {
        intersection() {
            token();
            translate([-1, split, -1]) cube([W + 2, L, T + 2]);
        }
        tails(clearance);
    }
}

if (part == "a") half_a();
else if (part == "b") translate([0, -split, 0]) half_b();
else if (part == "assembled") { half_a(); half_b(); }
else if (part == "laminated") {
    // Top layer as printed, on a bottom layer turned end over end (y -> L - y), pockets facing out.
    translate([0, 0, T]) { half_a(); half_b(); }
    translate([0, L, T]) rotate([180, 0, 0]) { half_a(); half_b(); }
}
else {
    // Both pieces on one plate, side by side, 4 mm apart: 105.6 x 132 mm with the default 5 in split.
    half_a();
    translate([2 * W + 4, split + tail_depth, 0]) rotate([0, 0, 180]) translate([0, -split, 0]) half_b();
}
