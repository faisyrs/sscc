"""Physical sizes of the token and its sticker."""
from dataclasses import dataclass

INCH = 25.4


@dataclass(frozen=True)
class Size:
    name: str
    width: float
    height: float
    margin: float  # distance from the edge to the content area
    notched: bool  # True when the outline has the token's 1-inch notches


# The token is 2 x 8 inches. The sticker sits in a 2 mm pocket on the token,
# so it is 4 mm smaller each way. The token's notches are 1.7 mm deep, so they
# stop short of the pocket and the sticker has straight edges.
SIZES = {
    "full": Size("full", 8 * INCH, 2 * INCH, 5.0, True),
    "sticker": Size("sticker", 8 * INCH - 4.0, 2 * INCH - 4.0, 3.0, False),
}
SIDES = ("setup", "in_play")
NOTCH_BASE, NOTCH_DEPTH = 1.6, 1.7  # matches hardware/token_2x8.scad
