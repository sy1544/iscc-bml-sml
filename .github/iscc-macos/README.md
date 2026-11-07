# ISCC macOS builds

The fork's [release workflow](../workflows/sync-upstream-release.yml) merges each
published add-on release, then builds it against the pinned ISCC 1.2.0 source.
Download the matching ZIP from the fork’s [Releases page](https://github.com/sy1544/iscc-bml-sml/releases). Choose `arm64` for
Apple Silicon or `x64` for Intel. The builds use local ad-hoc signing where
required by macOS and have no Developer ID signature or Apple notarization.
The workflow can be run manually to rebuild the latest release.

The app includes the Level Track BML/SML panel, MT5 management and account
settings, and the candle renderer. BML/SML and MT5 start disabled. A compatible
Windows MT5 receiver and the user's connection details are required. The
receiver sources, matching indicator, and example client settings are in the
app's `extensions/iscc-mt5-vps` directory within `Contents/Resources/app.asar`.

For a new Mac profile, copy the example client settings to
`~/Library/Application Support/ISCC/config/mt5-vps.json`, fill in the VPS
account, HTTPS endpoint, broker symbols, and TLS/authentication settings, and
restrict the file to your user. Keep credentials local. The kit's secure
configuration supports `secureAuthFile` and `clientCertFile` for mTLS. Set
`enabled` to true and restart to connect. Keep `tradingEnabled` false during
receiver and account verification. See the [kit integration guide](../../AGENT_INSTALL.md)
for receiver capabilities and demo checks. Level rendering can be configured
separately in the app settings after connecting the receiver.

If an upstream kit changes the integration hooks, the build fails until the
overlay is adapted. The workflow publishes a release only after both architectures
pass.
