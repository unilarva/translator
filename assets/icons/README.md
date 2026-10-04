# @unilarva/translator logo

This directory contains two versions of the @unilarva/translator logo:

- `unilarva-translator-logo.svg` - CSS-customizable master for inline use.
- `unilarva-translator-logo-adaptive.svg` - self-adapting external image for README files and ordinary `<img>` elements.

Both files have a transparent background and contain two separately editable Inkscape layers:

- `logo-u-mark` (`Unilarva U`)
- `logo-translator-mark` (`Translator bubbles`)

The paths inside the layers also have human-readable `logo-u-*` and `logo-translator-*` IDs.

## Customizable inline version

Use `unilarva-translator-logo.svg` when the SVG can be included directly in the HTML document. Its strokes use `currentColor`, so the logo inherits the surrounding CSS `color`.

Copy the contents of the SVG into the page and apply a class to its root element:

```html
<svg class="translator-logo" viewBox="0 0 256 256" aria-label="@unilarva/translator">
  <!-- Groups and paths from unilarva-translator-logo.svg -->
</svg>
```

```css
.translator-logo {
  width: 10rem;
  height: auto;
  color: var(--text-color);
}
```

The U and Translator bubbles can be styled independently:

```css
.translator-logo {
  color: #20242a;
  --logo-u-color: #aa01cb;
  --logo-u-opacity: 0.72;
  --logo-translator-color: currentColor;
  --logo-translator-opacity: 1;
}
```

Available custom properties:

| Property                    | Default        | Purpose                    |
| --------------------------- | -------------- | -------------------------- |
| `--logo-u-color`            | `currentColor` | U color                    |
| `--logo-u-opacity`          | `0.72`         | U opacity                  |
| `--logo-translator-color`   | `currentColor` | Translator bubbles color   |
| `--logo-translator-opacity` | `1`            | Translator bubbles opacity |

The properties must be applied to an inline SVG. An SVG loaded through `<img>` is an isolated document and cannot inherit `currentColor` or custom properties from the surrounding page.

## Self-adapting external version

Use `unilarva-translator-logo-adaptive.svg` when the logo is loaded as an external image:

```html
<img src="unilarva-translator-logo-adaptive.svg" alt="@unilarva/translator" width="160" />
```

It selects its color internally using `prefers-color-scheme`:

- Light mode: `#aa01cb`
- Dark mode: `#e0adee`
- U opacity: `0.68`

The U uses the same scheme color as the Translator bubbles, with reduced opacity for a subtle tint difference.

For a shared GitHub and npm README, place the adaptive SVG in the repository and use a stable absolute URL:

```html
<p align="center">
  <img
    src="https://raw.githubusercontent.com/unilarva/translator/main/assets/icons/unilarva-translator-logo-adaptive.svg"
    alt="@unilarva/translator"
    width="160"
  />
</p>
```

`prefers-color-scheme` follows the browser or operating-system preference. It cannot see a website's custom theme attribute or class when loaded through `<img>`. Use the inline version when the logo must follow a site-specific theme switch.

## Editing with Inkscape

The U and Translator bubbles are separate Inkscape layers and can be moved, copied, or edited independently.

To preserve CSS coloring, keep the individual paths set to:

```svg
stroke="currentColor"
```

Assigning a stroke color directly to a path in Inkscape may replace `currentColor` with a fixed value. For the customizable master, change the surrounding CSS `color` or the provided custom properties instead. For the adaptive version, edit the light and dark `color` declarations in its internal `<style>` block.

The Inkscape page/background color affects only the editing canvas and does not set the exported logo color.

## Icon license

Copyright © 2026 Lari Natri. Licensed under the Apache License, Version 2.0.
The Unilarva name and logo are project marks; no trademark rights are granted.
