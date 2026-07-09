"""Resolve Mind2Web website tokens to live start URLs."""

from __future__ import annotations

import json
from pathlib import Path

KNOWN: dict[str, str] = {
    "airbnb": "https://www.airbnb.com",
    "amctheatres": "https://www.amctheatres.com",
    "amtrak": "https://www.amtrak.com",
    "apartments": "https://www.apartments.com",
    "bestbuy": "https://www.bestbuy.com",
    "budget": "https://www.budget.com",
    "carmax": "https://www.carmax.com",
    "cars": "https://www.cars.com",
    "carvana": "https://www.carvana.com",
    "delta": "https://www.delta.com",
    "doordash": "https://www.doordash.com",
    "ebay": "https://www.ebay.com",
    "enterprise": "https://www.enterprise.com",
    "epicurious": "https://www.epicurious.com",
    "espn": "https://www.espn.com",
    "etsy": "https://www.etsy.com",
    "eventbrite": "https://www.eventbrite.com",
    "expedia": "https://www.expedia.com",
    "foodnetwork": "https://www.foodnetwork.com",
    "gamestop": "https://www.gamestop.com",
    "github": "https://github.com",
    "google": "https://www.google.com",
    "googleflights": "https://www.google.com/travel/flights",
    "googlemaps": "https://www.google.com/maps",
    "ikea": "https://www.ikea.com/us/en",
    "imdb": "https://www.imdb.com",
    "jetblue": "https://www.jetblue.com",
    "kayak": "https://www.kayak.com",
    "kbb": "https://www.kbb.com",
    "kohls": "https://www.kohls.com",
    "macys": "https://www.macys.com",
    "newegg": "https://www.newegg.com",
    "nordstrom": "https://www.nordstrom.com",
    "opentable": "https://www.opentable.com",
    "reddit": "https://www.reddit.com",
    "redfin": "https://www.redfin.com",
    "rei": "https://www.rei.com",
    "resy": "https://resy.com",
    "rottentomatoes": "https://www.rottentomatoes.com",
    "soundcloud": "https://soundcloud.com",
    "spotify": "https://open.spotify.com",
    "stackoverflow": "https://stackoverflow.com",
    "stubhub": "https://www.stubhub.com",
    "target": "https://www.target.com",
    "thumbtack": "https://www.thumbtack.com",
    "ticketmaster": "https://www.ticketmaster.com",
    "tripadvisor": "https://www.tripadvisor.com",
    "twitch": "https://www.twitch.tv",
    "ubereats": "https://www.ubereats.com",
    "underarmour": "https://www.underarmour.com",
    "uniqlo": "https://www.uniqlo.com/us/en",
    "united": "https://www.united.com",
    "viator": "https://www.viator.com",
    "weather": "https://weather.com",
    "webmd": "https://www.webmd.com",
    "yelp": "https://www.yelp.com",
    "zillow": "https://www.zillow.com",
}

_overrides_cache: dict[str, str] | None = None


def _key(website: str) -> str:
    return "".join(character for character in website.lower().strip() if character.isalnum())


def _load_overrides() -> dict[str, str]:
    global _overrides_cache
    if _overrides_cache is None:
        path = Path(__file__).resolve().parents[2] / "data" / "websites.json"
        try:
            _overrides_cache = json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            _overrides_cache = {}
    return _overrides_cache


def resolve_start_url(website: str) -> str:
    if not website:
        return ""
    key = _key(website)
    fallback_host = website.lower().strip() if "." in website else f"{key}.com"
    return _load_overrides().get(key) or KNOWN.get(key) or f"https://www.{fallback_host}"
