# Privacy

Semantic Dark processes page appearance locally inside Chrome. The shipped
extension has no telemetry, analytics, advertising or accounts. Its optional
local logo-repair mode communicates only with the companion on this computer.

## Data the extension reads

To decide whether a page needs help and to produce readable colors, the content
script may read:

- the current page host (hostname and, when present, port);
- computed styles, theme metadata, and visible surface/text relationships;
- inline SVG paint properties; and
- bounded pixel statistics from images that the browser permits the page to
  read. Cross-origin or otherwise tainted image data is left unchanged.

By default this processing stays in the browser. When local logo repair is
explicitly enabled for a host, bounded decoded pixels (at most 128 × 128 RGBA),
background colors and allowed action names are sent through the extension service
worker to `http://127.0.0.1:18949/decide`. Page URLs, DOM, cookies and credentials
are not sent. The companion uses local weights and a loopback-only inference
service; it does not call a cloud model. Missing, busy or slow companions leave
the image unchanged. Other image classes continue through the default router.

The companion caches up to 32 decisions in memory using hashes of its rendered
inputs. Its task-specific logs contain hashes, action choices, timing and model
identity, not the image pixels. Closing the companion clears its memory cache.

## Data stored locally

When a setting is changed, `chrome.storage.local` stores one record keyed by
host containing only:

- automatic, forced-on, or forced-off mode plus a derived legacy-compatibility
  boolean;
- preferred dark background color; and
- minimum text contrast; and
- whether experimental local logo repair is enabled for that host.

The settings are used only to apply the same behavior to that host in other
open tabs. Removing the extension clears its local storage. Choosing “Use
automatic behavior” stops the manual override but retains the appearance
preferences for that host.

## Permissions

The HTTP/HTTPS host permission is required because content scripts must inspect
and restyle the pages the user visits. The `storage` permission is required for
the per-host settings above. The `scripting` permission registers one of the
extension's own packaged scripts to run when a page starts loading, so the page
is dark before its first frame; hosts set to forced-off are excluded from that
registration, which stays in the browser. Semantic Dark does not request browsing-history,
cookies, identity, clipboard, downloads, or remote-code permissions.

The repository's optional `ml/` development tools can download explicitly
configured public datasets when a developer runs them; those tools are not
included in the built browser extension.

Last updated: 2026-11-04.
