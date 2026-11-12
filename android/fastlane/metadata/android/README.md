# Store listing mirror (read this before editing)

The files in this folder (`<locale>/title.txt`, `short_description.txt`, `full_description.txt`) are a
**mirror of the live Google Play listing**, copied byte for byte from the Play Developer API on
2026-11-12. They are not the source of truth. The live listing is edited through the Play API / Play
Console (and the listing experiment harness), so this copy can fall behind.

The Fastfile lanes do not upload listing text, images or screenshots (`skip_upload_metadata`,
`skip_upload_images` and `skip_upload_screenshots` are true). The one exception is the `screenshots` lane, which uploads the images under `<locale>/images/` and
refuses to run unless `ALLOW_LISTING_IMAGE_UPLOAD=1` is set. Do not flip those flags, and do not run
`fastlane supply` directly: fastlane uploads metadata by default, which would overwrite the live
listing with whatever is in these files.

To change the live listing, change it on Play (or through the harness), then refresh these files from
a fresh read of the live listing so the mirror stays equal to it.

Locales live on Play on 2026-11-12: en-US, de-DE, es-ES, fr-FR, hi-IN, it-IT, ja-JP, ko-KR, pt-BR, zh-CN.
