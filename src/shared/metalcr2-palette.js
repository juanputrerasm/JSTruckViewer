// METALCR2.ACT is the palette Monster Truck Madness 1 shipped in STARTUP.POD and applied to
// every paletted texture that does not have a same-name .ACT beside it. MTM2 keeps the same
// convention; its archives simply tend to provide a same-name palette for each texture.
//
// The bytes below are a verbatim copy of MTM1 ART/METALCR2.ACT: 256 RGB triplets, 768 bytes.
// Bundling it lets the viewer decode an MTM1 TRUCK.POD on its own, without STARTUP.POD.

export const METALCR2_ACT_NAME = "METALCR2.ACT";

export const METALCR2_PALETTE = Uint8Array.from(
  atob("AAAACAgIEBAQGRkZISEhKSkpMTExOjo6QkJCSkpKUlJSWlpaY2Nja2trc3Nze3t7hISEjIyMlJSUnJycpaWlra2ttbW1vb29xcXFzs7O1tbW3t7e5ubm7+/v9/f3////BQUFCgkJDg0NExISGBgXHRwaIyEeKCgjLS0mMjMqNzkuOj4xPUQ1QEs4QVA7Q1g/SWBFUGpLVXJRWntWYINcZo1ibJZncZ1ueaN2gqp/ibCHkbaPmLyXocKhqciprcytBgYGCwoKEA8PFBMTGRgYHxwcJSEgKiUlLykoNS0sOzIwQTY0Rzs4TT46U0M+WkhBYU1Ga1VMdFtRf2NWimtblHJfn3lkp4NsrYt0tJV9u52GwaWOyK6Xzrih1L+p2sezDgAAKQUBRAkDXw4EehMFlRgGsBwIyyEJ0j0M2FkQ33QT5ZAW7KwZ8sgd+eMg//8jABQUBh4UDCgUEjIUGDwUHkYVI1AVKVoVL2QVNW4VUIYnap45hbdLn89cuudu1P+APz8IT08KXl4Mbm4OfX0Qjo4Snp4Ur68Wv78Yz88a398c7+8e//8g//9N//95//+mPwgITwoKXgwMbg4OfRAQjhISnhQUrxYWvxgYzxoa3xwc7x4e/yEh/01N/3p6/6amQgsLUREOYRkQcCERgS0WkTUYoDwZsUIbv0we1lMZ71wS+WgY/3cj/5hP/7l6/9qmCAg/CgpPDAxeDg5uEBB9EhKOFBSeFhavGBi/GhrPHBzfHh7vICD/TU3/eXn/pqb/Mwg/QwpPUgxeYg5ucRB9ghKOkhSeoxavsxi/wRrPzhzf3B7v6SD/8E3/+Hn+/6b+CD8ICk8KDF4MDm4OEH0QEo4SFJ4UFq8WGL8YGs8aHN8cHu8eI/8jT/9Pev96pv+mGFpzIXOEKYyMMZycOaWlQq2tSr21Usa9Ws7GY9bGY9bOc97Oe+fehO/ehPfnnP/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    .split("")
    .map((char) => char.charCodeAt(0))
);
