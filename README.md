# Oroboro Dashboard — website

Showcase + build guide for the [Oroboro Dashboard](https://github.com/fpugliano/oroboro-dashboard), a free open-source marine instrument panel for Raspberry Pi.

Live at **https://build.sailingoroboro.com**

## Hosting

Static site on GitHub Pages. Two sections (Showcase / Build Guide) in a single `index.html`, switched client-side. Screenshots live in `/screenshots`.

## Custom domain

The `CNAME` file points the site at `build.sailingoroboro.com`. In your DNS, add a CNAME record for the `dashboard` subdomain pointing to `fpugliano.github.io` (or the four GitHub Pages A records for an apex — but a subdomain uses CNAME).

## Local preview

Any static server works, e.g.:

```
python3 -m http.server 8080
```

then open http://localhost:8080
