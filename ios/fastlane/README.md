fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios upload_only

```sh
[bundle exec] fastlane ios upload_only
```

Build and upload binary only (no submission). Use when IAPs need to be attached manually in App Store Connect before submitting.

### ios build_and_submit

```sh
[bundle exec] fastlane ios build_and_submit
```

Build and submit to App Store for review

### ios submit_for_review

```sh
[bundle exec] fastlane ios submit_for_review
```



----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
